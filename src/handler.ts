import path from "path";
import { getRecentTweets } from "./twitter-api";
import { EntitiesResult, Entity, EntityType, TopEntity, Tweet } from "./types";
import sqlite3, { Database } from "better-sqlite3";
import fs from "fs-extra";

const TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities.json");
const PERIOD_TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "period-top-entities.json");
const DB_PATH = path.resolve(process.env.HOME_DIR!!, "twitter.db");

let db: Database;

const ensureDBIsReady = () => {
  if (!db) {
    db = sqlite3(DB_PATH);

    db.exec("CREATE TABLE IF NOT EXISTS tweets (id TEXT PRIMARY KEY, count INTEGER)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS entities (name TEXT, type INTEGER, count INTEGER, processed INTEGER, lastUpdateTime TEXT, PRIMARY KEY (name, type))"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS top_entities (name TEXT, type INTEGER, count INTEGER, date TEXT, PRIMARY KEY (name, type, date))"
    );
  }
};

// ############ READERS #############

async function _fetchTopEntities() {
  return success(await fs.readJson(TOP_ENTITIES_PATH));
}

async function _fetchPeriodTopEntities() {
  return success(await fs.readJson(PERIOD_TOP_ENTITIES_PATH));
}

// ############ WRITERS #############

const _saveTopEntities = async () => {
  console.log("---- Fetching recent tweets ----");
  const response = await getRecentTweets();

  const tweets: Array<Tweet> = response.includes.tweets.map((t: any): Tweet => {
    return { id: t.id, entities: t.entities, public_metrics: t.public_metrics, counterToUpdate: 0 };
  });

  console.log("---- Updating tweets ----");
  for (const t of tweets) {
    t.counterToUpdate = await updateTweet(t);
  }

  console.log("---- Processing entities ----");
  await setProcessedEntities();

  console.log("---- Update entities ----");
  await updateEntities(tweets);

  console.log("---- Writing result ----");
  await writeTopEntitiesToDisk();

  return success("OK");
};

const _cleanAndSavePeriodTopEntities = async () => {
  console.log("---- Save Period Top Entities ----");
  const yesterdayTopEntities = await savePeriodTopEntities();
  const weeklyTopEntities = await fetchWeeklyTopEntities();
  console.log("---- Write Period Top Entities ----");
  await writePeriodTopEntities(yesterdayTopEntities, weeklyTopEntities);
  console.log("---- Truncating entities ----");
  await truncateEntities();
};

// ############ INTERNALS #############

const updateTweet = async (tweet: Tweet) => {
  let count = tweet.public_metrics.retweet_count + tweet.public_metrics.quote_count;

  const prev: any = db.prepare("select * from tweets where id = ?").get(tweet.id);

  if (!prev) {
    db.prepare("insert into tweets values (?,?)").run(tweet.id, count);
    return count;
  } else {
    db.prepare("update tweets set count = ? where id = ?").run(count, tweet.id);
    return count - prev.count;
  }
};

const setProcessedEntities = async () => {
  return db
    .prepare(
      "update entities set processed = count, lastUpdateTime = datetime() where not IFNULL(processed, -1) = count"
    )
    .run();
};

const updateEntities = async (tweets: Array<Tweet>) => {
  const entities: Array<Entity> = [];

  tweets.forEach((t: Tweet) => {
    if (t.entities.cashtags) {
      t.entities.cashtags.forEach((cashtag) => {
        const entity = entities.find((e) => e.name === cashtag.tag && e.type === EntityType.CASHHASH);

        if (entity) {
          entity.count += t.counterToUpdate;
        } else {
          entities.push({
            type: EntityType.CASHHASH,
            name: cashtag.tag,
            count: t.counterToUpdate,
          });
        }
      });
    }

    if (t.entities.hashtags) {
      t.entities.hashtags.forEach((hashtag) => {
        const entity = entities.find((e) => e.name === hashtag.tag && e.type === EntityType.HASHTAG);

        if (entity) {
          entity.count += t.counterToUpdate;
        } else {
          entities.push({
            type: EntityType.HASHTAG,
            name: hashtag.tag,
            count: t.counterToUpdate,
          });
        }
      });
    }

    if (t.entities.mentions) {
      t.entities.mentions.forEach((mention) => {
        const entity = entities.find((e) => e.name === mention.username && e.type === EntityType.MENTION);

        if (entity) {
          entity.count += t.counterToUpdate;
        } else {
          entities.push({
            type: EntityType.MENTION,
            name: mention.username,
            count: t.counterToUpdate,
          });
        }
      });
    }

    if (t.entities.urls) {
      t.entities.urls.forEach((url) => {
        const entity = entities.find((e) => e.name === url.url && e.type === EntityType.URL);

        if (entity) {
          entity.count += t.counterToUpdate;
        } else {
          entities.push({
            type: EntityType.URL,
            name: url.url,
            count: t.counterToUpdate,
          });
        }
      });
    }
  });

  const entitiesStatement = db.prepare(
    "Insert INTO entities(type,name,count,lastUpdateTime) values (?,?,?,datetime())\n" +
      "ON CONFLICT (type,name) DO UPDATE SET count = count + ?, lastUpdateTime = datetime()"
  );

  db.transaction((entities: Array<Entity>) => {
    entities.forEach((entity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count, entity.count);
    });
  })(entities);

  console.log("done updateEntities");
};

const writeTopEntitiesToDisk = async () => {
  const topEntities = await fetchTopEntities(50);

  await fs.writeJson(TOP_ENTITIES_PATH, topEntities);
};

const fetchTopEntities = async (limit: number): Promise<EntitiesResult> => {
  const hashtags = db
    .prepare(
      `select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit ${limit}`
    )
    .all(EntityType.HASHTAG);
  const cashtags = db
    .prepare(
      `select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit ${limit}`
    )
    .all(EntityType.CASHHASH);
  const mentions = db
    .prepare(
      `select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit ${limit}`
    )
    .all(EntityType.MENTION);
  const urls = db
    .prepare(
      `select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit ${limit}`
    )
    .all(EntityType.URL);

  return {
    hashtags,
    cashtags,
    mentions,
    urls,
  };
};

const savePeriodTopEntities = async () => {
  const yesterdayTopEntities: Array<TopEntity> = [
    db.prepare(`select type, count, name from entities where type = ? order by count desc`).get(EntityType.HASHTAG),
    db.prepare(`select type, count, name from entities where type = ? order by count desc`).get(EntityType.CASHHASH),
    db.prepare(`select type, count, name from entities where type = ? order by count desc`).get(EntityType.MENTION),
    db.prepare(`select type, count, name from entities where type = ? order by count desc`).get(EntityType.URL),
  ].filter((e) => !!e);

  const entitiesStatement = db.prepare("Insert INTO top_entities(type,name,count,date) values (?,?,?,date())");

  db.transaction((entities: Array<TopEntity>) => {
    entities.forEach((entity: TopEntity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count);
    });
  })(yesterdayTopEntities);

  return yesterdayTopEntities;
};

const fetchWeeklyTopEntities = async () => {
  const weeklyTopEntities: Array<TopEntity> = [
    db
      .prepare(
        `select type, count, name from top_entities where date > (SELECT DATETIME('now', '-7 day')) and type = ? order by count desc`
      )
      .get(EntityType.HASHTAG),
    db
      .prepare(
        `select type, count, name from top_entities where date > (SELECT DATETIME('now', '-7 day')) and type = ? order by count desc`
      )
      .get(EntityType.CASHHASH),
    db
      .prepare(
        `select type, count, name from top_entities where date > (SELECT DATETIME('now', '-7 day')) and type = ? order by count desc`
      )
      .get(EntityType.MENTION),
    db
      .prepare(
        `select type, count, name from top_entities where date > (SELECT DATETIME('now', '-7 day')) and type = ? order by count desc`
      )
      .get(EntityType.URL),
  ];

  return weeklyTopEntities;
};

const writePeriodTopEntities = async (yesterdayTopEntities: Array<TopEntity>, weeklyTopEntities: Array<TopEntity>) => {
  await fs.writeJson(PERIOD_TOP_ENTITIES_PATH, {
    yesterdayTopEntities,
    weeklyTopEntities,
  });
};

const truncateEntities = async () => {
  db.prepare("DELETE FROM entities").run();
};

// ############ WRAPPERS #############

function success(result: any) {
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    body: result,
  };
}

async function beforeRunningFunc(this: any, event: any, context: any) {
  ensureDBIsReady();
  return await this(event, context);
}

async function catchErrors(this: any, event: any, context: any) {
  try {
    return await this(event, context);
  } catch (err) {
    const message = err.stack || err.toString();
    console.error(message);
    return {
      statusCode: 500,
      body: message,
    };
  }
}

export const reader_fetchTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchTopEntities));
export const reader_fetchPeriodTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchPeriodTopEntities));
export const writer_saveTopEntities = catchErrors.bind(beforeRunningFunc.bind(_saveTopEntities));
export const writer_cleanAndSavePeriodTopEntities = catchErrors.bind(
  beforeRunningFunc.bind(_cleanAndSavePeriodTopEntities)
);
