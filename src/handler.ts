import path from "path";
import { getRecentTweets } from "./twitter-api";
import { EntitiesResult, Entity, EntityType, Tweet } from "./types";
import sqlite3, { Database } from "better-sqlite3";
import fs from "fs-extra";

const TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities.json");
const DB_PATH = path.resolve(process.env.HOME_DIR!!, "twitter.db");

let db: Database;

const ensureDBIsReady = () => {
  if (!db) {
    db = sqlite3(DB_PATH);

    db.exec("CREATE TABLE IF NOT EXISTS tweets (id TEXT PRIMARY KEY, count INTEGER)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS entities (name TEXT, type INTEGER, count INTEGER, processed INTEGER, lastUpdateTime TEXT, PRIMARY KEY (name, type))"
    );
  }
};

// ############ READER #############

async function _reader(event: any, context: any) {
  return success(await fs.readJson(TOP_ENTITIES_PATH));
}

// ############ WRITER #############

const _writer = async (event: any, context: any) => {
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
    .prepare("update entities set processed = count, lastUpdateTime = ? where not IFNULL(processed, -1) = count")
    .run(new Date().toUTCString());
};

const updateEntities = async (tweets: Array<Tweet>) => {
  const time = new Date();

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
            lastUpdateTime: time,
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
            lastUpdateTime: time,
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
            lastUpdateTime: time,
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
            lastUpdateTime: time,
          });
        }
      });
    }
  });

  const entitiesStatement = db.prepare(
    "Insert INTO entities(type,name,count,lastUpdateTime) values (?,?,?,?)\n" +
      "ON CONFLICT (type,name) DO UPDATE SET count = count + ?, lastUpdateTime = ?"
  );

  db.transaction((entities: Array<Entity>) => {
    entities.forEach((entity) => {
      entitiesStatement.run(
        entity.type,
        entity.name,
        entity.count,
        entity.lastUpdateTime.toUTCString(),
        entity.count,
        entity.lastUpdateTime.toUTCString()
      );
    });
  })(entities);

  console.log("done updateEntities");
};

const writeTopEntitiesToDisk = async () => {
  const topEntities = await fetchTopEntities();

  await fs.writeJson(TOP_ENTITIES_PATH, JSON.stringify(topEntities));
};

const fetchTopEntities = async (): Promise<EntitiesResult> => {
  const hashtags = db
    .prepare(
      "select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit 100"
    )
    .all(EntityType.HASHTAG);
  const cashtags = db
    .prepare(
      "select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit 100"
    )
    .all(EntityType.CASHHASH);
  const mentions = db
    .prepare(
      "select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit 100"
    )
    .all(EntityType.MENTION);
  const urls = db
    .prepare(
      "select processed, count, name, lastUpdateTime from entities where type = ? order by processed desc, count desc limit 100"
    )
    .all(EntityType.URL);

  return {
    hashtags,
    cashtags,
    mentions,
    urls,
  };
};

// wrapper

function success(result: any) {
  return {
    statusCode: 200,
    body: JSON.stringify(result, null, 2),
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

// example

async function fetchJson() {
  const response = await fetch("https://httpbin.org/gzip"); // some example JSON web service
  return await response.json();
}

// exports

export const reader = catchErrors.bind(beforeRunningFunc.bind(_reader));
export const writer = catchErrors.bind(beforeRunningFunc.bind(_writer));
