import path from "path";
import { getRecentTweets } from "./twitter-api";
import {
  Entities,
  EntitiesResult,
  Entity,
  EntityType,
  RecentResults,
  Status,
  TopEntity,
  TweetResponse,
  TweetsResponse
} from "./types";
import sqlite3, { Database } from "better-sqlite3";
import fs from "fs-extra";
import { createHash } from "crypto";

const SECRETS = process.env.REPO_SECRETS_JSON ? JSON.parse(process.env.REPO_SECRETS_JSON) : {};
const TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities.json");
const PERIOD_TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "period-top-entities.json");
const DB_PATH = path.resolve(process.env.HOME_DIR!!, "twitter.db");
const MONTH = 30 * 24 * 60 * 60 * 1000;

const EXCLUDED_ENTITIES = [
  "defi",
  "crypto",
  "cryptocurrency",
  "cryptocurrencies",
  "airdrop",
  "airdrops",
  "yieldfarming",
  "bsc",
  "bitcoin",
  "eth",
  "binance",
  "binancesmartchain",
  "ethereum",
  "nft",
  "nfts",
  "btc",
  "trading",
  "binancechain",
  "bnb",
  "altcoin",
  "Blockchain",
  "giveaway",
  "BSCGems",
  "Giveaways",
  "cryptonews",
  "ElonMusk",
  "cryptoart",
  "PancakeSwap",
  "nftart",
  "NFTCommunity",
  "HODL",
  "Cryptocurency",
  "GiveawayAlert",
  "cz_binance"
]
  .map((e) => `'${e}'`)
  .join(",");

let db: Database;

const ensureDBIsReady = () => {
  if (!db) {
    db = sqlite3(DB_PATH);

    db.exec("CREATE TABLE IF NOT EXISTS tweets (id TEXT PRIMARY KEY)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS entities (name TEXT, type INTEGER, count INTEGER, processed INTEGER, lastUpdateTime TEXT, extra TEXT, PRIMARY KEY (name, type))"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS top_entities (name TEXT, type INTEGER, count INTEGER, extra TEXT, date TEXT, PRIMARY KEY (name, type, date))"
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

async function _fetchTweetsByTag(bearerToken: string, event: any, context: any) {
  const sinceId = event.pathParameters.sinceId;
  const filter = event.pathParameters.filter;

  const response: RecentResults = await getRecentTweets(bearerToken, 10, null, filter, sinceId);
  const statuses = filterStatusesForBots(response.statuses);

  const tweetsResponse: TweetsResponse = {
    sinceId: statuses.length ? statuses[0].id_str : "",
    tweets: statuses.map((status: Status): TweetResponse => {
      return {
        text: status.retweeted_status?.full_text || status.full_text,
        user: {
          displayName: status.retweeted_status?.user.name || status.user.name,
          name: status.retweeted_status?.user.screen_name || status.user.screen_name,
          followers: status.retweeted_status?.user.followers_count || status.user.followers_count,
          following: status.retweeted_status?.user.friends_count || status.user.friends_count,
          profileImage: status.retweeted_status?.user.profile_image_url_https || status.user.profile_image_url_https
        }
      };
    })
  };

  return success(tweetsResponse);
}

// ############ WRITERS #############

const _cleanDB = async (event: any, context: any) => {
  console.log("---- Cleaning DB ----");

  const param = event.pathParameters.param;

  if (param === "all") {
    db.prepare("DELETE FROM top_entities").run();
    db.prepare("DELETE FROM entities").run();
    db.prepare("DELETE FROM tweets").run();
  } else if (param === "top") {
    db.prepare("DELETE FROM top_entities").run();
  } else if (param === "entities") {
    db.prepare("DELETE FROM entities").run();
  } else if (param === "tweets") {
    db.prepare("DELETE FROM tweets").run();
  }

  return success("OK");
};

const _saveTopEntities = async (bearerToken: string, event: any, context: any, runs: number = 14) => {
  console.log("---- Fetching recent tweets ----");

  let maxId: string | null = null;
  let currentRun: number = 0;

  if (event["taskresult"]) {
    const previousResult = JSON.parse(event["taskresult"].body);
    maxId = previousResult.maxId;
    currentRun = previousResult.currentRun;
  }

  console.log("maxId", maxId);
  console.log("currentRun", currentRun);

  //for (let _runs = 0; _runs < runs; _runs++) {
  //console.log(`---- Loop number ${_runs} ----`);
  console.log(`---- Loop number ${new Date()} ----`);

  const response: RecentResults = await getRecentTweets(
    bearerToken,
    100,
    maxId,
    "(#defi OR #crypto OR #cryptocurrency)"
  );

  // Max id to page to the next result
  maxId = extractMaxId(response.search_metadata.next_results);

  // Filtering bots
  const statuses = filterStatusesForBots(response.statuses);

  // Keep for debugging1
  // if (statuses.length !== response.statuses.length) {
  //   console.log("Amount of statuses filtered", response.statuses.length - statuses.length);
  //   response.statuses
  //     .filter((status: Status) => statuses.some((s: Status) => status.id_str === s.id_str))
  //     .forEach((status: Status) => {
  //       if (new Date(status.user.created_at).getTime() > new Date().getTime() - MONTH) {
  //         console.log("---- User is not month old ----", new Date(status.user.created_at));
  //       }
  //       if (status.user.followers_count > 0) {
  //         console.log("---- User does not have any followers ----");
  //       }
  //       if (!status.user.default_profile_image) {
  //         console.log("---- User has a default profile image ----");
  //       }
  //     });
  // } else {
  //   console.log("---- No users were filtered ----");
  // }

  console.log("---- Inserting tweets ----");
  await updateTweets(statuses);

  console.log("---- Processing entities ----");
  await setProcessedEntities();

  console.log("---- Update entities ----");
  await updateEntities(statuses);

  console.log("---- Writing result ----");
  await writeTopEntitiesToDisk();

  //  await sleep(3000);
  //}

  return success(
    {
      maxId,
      currentRun: currentRun + 1
    },
    currentRun < runs);
};

const _cleanAndSavePeriodTopEntities = async () => {
  console.log("---- Save Period Top Entities ----");
  await _writePeriodTopEntities();
  console.log("---- Truncating entities ----");
  await truncateData();
};

// ############ INTERNALS #############

function filterStatusesForBots(statuses: Array<Status>): Array<Status> {

  if (statuses) {
    return statuses.filter((status: Status) => {
      return (
        new Date(status.user.created_at).getTime() < new Date().getTime() - MONTH &&
        status.user.followers_count > 0 &&
        !status.user.default_profile_image
      );
    });
  }

  return [];
}

async function _writePeriodTopEntities() {
  const yesterdayTopEntities = await savePeriodTopEntities();
  const weeklyTopEntities = await fetchWeeklyTopEntities();
  console.log("---- Write Period Top Entities ----");
  await writePeriodTopEntities(yesterdayTopEntities, weeklyTopEntities);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const extractMaxId = (next_results: string) => {
  const queryParameters: any = new URL(`http://localhost${next_results}`);
  return queryParameters.searchParams.get("max_id");
};

const updateTweets = async (statuses: Array<Status>) => {
  const result: Array<string> = db
    .prepare(`select * from tweets where id in (${statuses.map((s) => `'${s.id_str}'`).join(",")})`)
    .all()
    .map((t) => t.id);

  statuses = statuses.filter((s: Status) => !result.includes(s.id_str));

  const tweetsStatement = db.prepare("insert into tweets values (?)");

  db.transaction((statuses: Array<Status>) => {
    statuses.forEach((status: Status) => {
      tweetsStatement.run(status.id_str);
    });
  })(statuses);
};

const setProcessedEntities = async () => {
  return db
    .prepare(
      "update entities set processed = count, lastUpdateTime = datetime() where not IFNULL(processed, -1) = count"
    )
    .run();
};

const updateEntities = async (statuses: Array<Status>) => {
  const entitiesToSave: Array<Entity> = [];

  statuses.forEach((status: Status) => {
    let entities: Entities = {
      hashtags: [],
      symbols: [],
      urls: [],
      user_mentions: []
    };

    if (status.quoted_status) {
      entities.hashtags = status.entities.hashtags.concat(status.quoted_status.entities.hashtags);
      entities.symbols = status.entities.symbols.concat(status.quoted_status.entities.symbols);
      entities.urls = status.entities.urls.concat(status.quoted_status.entities.urls);
      entities.user_mentions = status.entities.user_mentions.concat(status.quoted_status.entities.user_mentions);
    } else if (status.retweeted_status) {
      entities = status.retweeted_status.entities;
    } else {
      entities = status.entities;
    }

    entities.symbols.forEach(({ text: cashtag }) => {
      const entity = entitiesToSave.find((e) => e.name === cashtag && e.type === EntityType.CASHHASH);

      if (entity) {
        entity.count += 1;
      } else {
        entitiesToSave.push({
          type: EntityType.CASHHASH,
          name: cashtag,
          count: 1
        });
      }
    });

    entities.hashtags.forEach(({ text: hashtag }) => {
      const entity = entitiesToSave.find((e) => e.name === hashtag && e.type === EntityType.HASHTAG);

      if (entity) {
        entity.count += 1;
      } else {
        entitiesToSave.push({
          type: EntityType.HASHTAG,
          name: hashtag,
          count: 1
        });
      }
    });

    entities.user_mentions.forEach(({ screen_name: mention, name }) => {
      const entity = entitiesToSave.find((e) => e.name === mention && e.type === EntityType.MENTION);

      if (entity) {
        entity.count += 1;
      } else {
        entitiesToSave.push({
          type: EntityType.MENTION,
          name: mention,
          extra: name,
          count: 1
        });
      }
    });

    entities.urls
      .filter(({ expanded_url }) => expanded_url.indexOf("twitter.com") === -1)
      .forEach(({ url, expanded_url }) => {
        const entity = entitiesToSave.find((e) => e.name === url && e.type === EntityType.URL);

        if (entity) {
          entity.count += 1;
        } else {
          entitiesToSave.push({
            type: EntityType.URL,
            name: url,
            extra: expanded_url,
            count: 1
          });
        }
      });
  });

  const entitiesStatement = db.prepare(
    "Insert INTO entities(type,name,count,lastUpdateTime,extra) values (?,?,?,datetime(),?)\n" +
    "ON CONFLICT (type,name) DO UPDATE SET count = count + ?, lastUpdateTime = datetime()"
  );

  db.transaction((entities: Array<Entity>) => {
    entities.forEach((entity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count, entity.extra, entity.count);
    });
  })(entitiesToSave);

  console.log("done updateEntities");
};

const writeTopEntitiesToDisk = async () => {
  const topEntities = await fetchTopEntities(30);

  await fs.writeJson(TOP_ENTITIES_PATH, topEntities);
};

const fetchTopEntities = async (limit: number): Promise<EntitiesResult> => {
  const prepareStatement = `select processed, count, name, extra, lastUpdateTime from entities where type = ?
       and not name COLLATE NOCASE in (${EXCLUDED_ENTITIES}) order by processed desc, count desc limit ${limit}`;

  const hashtags = db.prepare(prepareStatement).all(EntityType.HASHTAG);
  const cashtags = db.prepare(prepareStatement).all(EntityType.CASHHASH);
  const mentions = db.prepare(prepareStatement).all(EntityType.MENTION);
  const urls = db.prepare(prepareStatement).all(EntityType.URL);

  return {
    hashtags,
    cashtags,
    mentions,
    urls
  };
};

const savePeriodTopEntities = async () => {
  const preparedStatement = `select type, count, name, extra from entities where type = ? 
    and not name COLLATE NOCASE in (${EXCLUDED_ENTITIES}) order by count desc`;

  const yesterdayTopEntities: Array<TopEntity> = [
    db.prepare(preparedStatement).get(EntityType.HASHTAG),
    db.prepare(preparedStatement).get(EntityType.CASHHASH),
    db.prepare(preparedStatement).get(EntityType.MENTION),
    db.prepare(preparedStatement).get(EntityType.URL)
  ].filter((e) => !!e);

  const entitiesStatement = db.prepare("Insert INTO top_entities(type,name,count,extra,date) values (?,?,?,?,date())");

  db.transaction((entities: Array<TopEntity>) => {
    entities.forEach((entity: TopEntity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count, entity.extra);
    });
  })(yesterdayTopEntities);

  return yesterdayTopEntities;
};

const fetchWeeklyTopEntities = async () => {
  const preparedStatement = `select type, count, name, extra from top_entities where 
        date > (SELECT DATETIME('now', '-7 day')) and type = ? and not name COLLATE NOCASE in (${EXCLUDED_ENTITIES}) order by count desc`;

  const weeklyTopEntities: Array<TopEntity> = [
    db.prepare(preparedStatement).get(EntityType.HASHTAG),
    db.prepare(preparedStatement).get(EntityType.CASHHASH),
    db.prepare(preparedStatement).get(EntityType.MENTION),
    db.prepare(preparedStatement).get(EntityType.URL)
  ];

  return weeklyTopEntities;
};

const writePeriodTopEntities = async (yesterdayTopEntities: Array<TopEntity>, weeklyTopEntities: Array<TopEntity>) => {
  await fs.writeJson(PERIOD_TOP_ENTITIES_PATH, {
    yesterdayTopEntities,
    weeklyTopEntities
  });
};

const truncateData = async () => {
  db.prepare("DELETE FROM entities").run();
  db.prepare("DELETE FROM tweets").run();
};

// ############ WRAPPERS #############

function success(result: any, _continue?: boolean) {
  const response:any = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(result)
  };

  if (_continue !== undefined) {
    response.continue = _continue;
  }

  return response;
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
      body: message
    };
  }
}

async function authorize(this: any, event: any, context: any) {
  const secret = event.pathParameters.secret;

  if (
    createHash("sha256").update(secret).digest("hex") ===
    "31c9e5d9c2c530ff6433380c75fe5eacac4eb4877a50c8934defb4c6b39a0554"
  ) {
    return await this(event, context);
  } else {
    return {
      statusCode: 401,
      body: "Unauthorized"
    };
  }
}

export const reader_fetchTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchTopEntities));
export const reader_fetchPeriodTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchPeriodTopEntities));
export const writer_saveTopEntities = catchErrors.bind(beforeRunningFunc.bind(_saveTopEntities.bind(null, SECRETS.BEARER_TOKEN)));
export const writer_cleanAndSavePeriodTopEntities = catchErrors.bind(beforeRunningFunc.bind(_cleanAndSavePeriodTopEntities));
export const writer_cleanDB = authorize.bind(catchErrors.bind(beforeRunningFunc.bind(_cleanDB)));
export const reader_fetchTweetsByTag = catchErrors.bind(beforeRunningFunc.bind(_fetchTweetsByTag.bind(null, SECRETS.TWEETS_BY_TAG_BEARER_TOKEN)));