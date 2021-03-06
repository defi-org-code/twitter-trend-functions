import path from "path";
import { getRecentTweets, getRecentTweetsOfList } from "./twitter-api";
import {
  Entities,
  EntitiesResult,
  Entity,
  EntityType,
  RecentResults,
  Status,
  TopEntity,
  TweetResponse,
  TweetsResponse,
  User,
  UserResponse,
} from "./types";
import sqlite3, { Database } from "better-sqlite3";
import fs from "fs-extra";
import { createHash } from "crypto";

const SECRETS = process.env.REPO_SECRETS_JSON ? JSON.parse(process.env.REPO_SECRETS_JSON) : {};

const TOP_ENTITIES_WITHOUT_RETWEETS_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities_without_retweets.json");
const TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities.json");
const TOP_ENTITIES_OF_LIST_PATH = path.resolve(process.env.HOME_DIR!!, "top-entities-of-list-$LIST_ID.json");

const ACTIVE_USERS_PATH = path.resolve(process.env.HOME_DIR!!, "active-users-$LIST_ID.json");

const PERIOD_TOP_ENTITIES_WITHOUT_RETWEETS_PATH = path.resolve(
  process.env.HOME_DIR!!,
  "period-top-entities_without_retweets.json"
);
const PERIOD_TOP_ENTITIES_PATH = path.resolve(process.env.HOME_DIR!!, "period-top-entities.json");
const PERIOD_TOP_ENTITIES_OF_LIST_PATH = path.resolve(process.env.HOME_DIR!!, "period-top-entities-$LIST_ID.json");

const DB_PATH = path.resolve(process.env.HOME_DIR!!, "twitter.db");
const DB_SUFFIX_WITHOUT_RETWEETS = "without_retweets";
const MONTH = 30 * 24 * 60 * 60 * 1000;

const EXCLUDED_ENTITIES = [
  "defi",
  "crypto",
  "cryptocurrency",
  "cryptocurrencies",
  "airdrop",
  "airdrops",
  "AirdropCrypto",
  "NFTartist",
  "Amazon",
  "pinterest",
  "money",
  "business",
  "cryptoartist",
  "bitcoinnews",
  "NFTcollectibles",
  "freecoins",
  "altcoingems",
  "linkedin",
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
  "cz_binance",
  "ICOAnnouncement",
  "china",
  "Airdropinspector",
  "cryptoairdrop",
  "cryptotrading",
  "presale",
  "100xCoin",
  "dapp",
  "token",
  "erc20",
  "erc20news",
  "pump",
  "fintech",
  "affiliatemarketing",
  "shopping",
  "twitter",
  "facebook",
  "instagram",
  "socialmedia",
  "gift",
  "gifts",
  "giftideas",
  "shop",
  "tumblr",
  "deal",
  "USDT",
  "investing",
  "IDO",
  "yield",
  "CoinMarketCap",
  "definews",
  "cryptogiveaway",
  "cryptocrash",
  "cryptotwitter",
  "airdropalert",
  "cryptomoonshots",
  "altcoins",
  "BSCArmy",
  "CryptoGems",
  "BSCs",
  "BSCGem",
  "gem",
  "freetokens",
  "legit",
  "elon",
  "nftcollector",
  "NFTdrop",
  "AirdropDetective",
  "ICO",
];

const EXCLUDED_ENTITIES_STRING = EXCLUDED_ENTITIES.map((e) => `'${e}'`).join(",");

let db: Database;

const ensureDBIsReady = (dbSuffix: string = "") => {
  console.log(`Ensuring DB with path ${dbSuffix}`);
  if (!db) {
    db = sqlite3(DB_PATH.replace(".db", `_${dbSuffix}.db`));

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

async function _fetchTopEntitiesWithoutRetweets() {
  return success(await fs.readJson(TOP_ENTITIES_WITHOUT_RETWEETS_PATH));
}

async function _fetchTopEntities() {
  return success(await fs.readJson(TOP_ENTITIES_PATH));
}

async function _fetchTopEntitiesOfList(event: any) {
  const listId = event.pathParameters.listId;
  return success(await fs.readJson(TOP_ENTITIES_OF_LIST_PATH.replace("$LIST_ID", listId)));
}

// --

async function _fetchActiveUsersOfList(event: any) {
  const listId = event.pathParameters.listId;
  return success(await fs.readJson(ACTIVE_USERS_PATH.replace("$LIST_ID", listId)));
}

// --

async function _fetchPeriodTopEntitiesWithoutRetweets() {
  return success(await fs.readJson(PERIOD_TOP_ENTITIES_WITHOUT_RETWEETS_PATH));
}

async function _fetchPeriodTopEntities() {
  return success(await fs.readJson(PERIOD_TOP_ENTITIES_PATH));
}

async function _fetchPeriodTopEntitiesOfList(event: any) {
  const listId = event.pathParameters.listId;
  return success(await fs.readJson(PERIOD_TOP_ENTITIES_OF_LIST_PATH.replace("$LIST_ID", listId)));
}

// --

async function _fetchTweetsByTag(bearerToken: string, event: any, context: any) {
  const sinceId = event.pathParameters.sinceId;
  const withoutRetweets = event.queryStringParameters?.withoutRetweets;
  const filter = `${event.pathParameters.filter}${withoutRetweets ? " -filter:retweets" : ""}`;

  console.log("filtering", filter);

  const response: RecentResults = await getRecentTweets(bearerToken, 25, null, filter, sinceId);
  const statuses = filterStatusesForBots(response.statuses);

  const tweetsResponse: TweetsResponse = {
    sinceId: statuses.length ? statuses[0].id_str : "",
    tweets: statuses.map((status: Status): TweetResponse => {
      return {
        text:
          (status.quoted_status
            ? `${status.quoted_status?.full_text}\n\r${status.retweeted_status?.full_text}`
            : null) ||
          status.retweeted_status?.full_text ||
          status.full_text,
        tweetId: status.id_str,
        user: {
          displayName: status.user.name,
          name: status.user.screen_name,
          followers: status.user.followers_count,
          following: status.user.friends_count,
          profileImage: status.user.profile_image_url_https,
        },
      };
    }),
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
    db.prepare("DELETE FROM users_lists").run();
  } else if (param === "top") {
    db.prepare("DELETE FROM top_entities").run();
  } else if (param === "entities") {
    db.prepare("DELETE FROM entities").run();
  } else if (param === "tweets") {
    db.prepare("DELETE FROM tweets").run();
  }

  db.exec("VACUUM;");

  return success("OK");
};

// --

const _getTweetsOfList = async (bearerToken: string, maxId: string | null, event: any): Promise<RecentResults> => {
  console.log("---- Fetching recent tweets by verified users ----");
  const listId = event.pathParameters.listId;

  const response: RecentResults = await getRecentTweetsOfList(bearerToken, 200, listId, maxId);

  return response;
};

const _getAllTweets = async (bearerToken: string, maxId: string | null, event: any): Promise<RecentResults> => {
  console.log("---- Fetching recent tweets by all ----");

  return await _getTweets(bearerToken, maxId, event);
};

const _getAllTweetsWithoutRetweets = async (
  bearerToken: string,
  maxId: string | null,
  event: any
): Promise<RecentResults> => {
  console.log("---- Fetching recent tweets by all without retweets ----");

  return await _getTweets(bearerToken, maxId, event, "-filter:retweets");
};

const _getTweets = async (
  bearerToken: string,
  maxId: string | null,
  event: any,
  addedFilter: string = ""
): Promise<RecentResults> => {
  return await getRecentTweets(
    bearerToken,
    100,
    maxId,
    `(#defi OR #crypto OR #cryptocurrency OR #blockchain OR #bitcoin OR $cryptocurrencies OR #ethereum OR #definews OR #yieldfarming OR #bsc OR #solana OR #polygon OR #matic OR #fantom OR #kcs OR #heco OR #arbitrum OR #layer2) ${addedFilter}`
  );
};

// --

async function _saveTopEntities(
  this: Function,
  bearerToken: string,
  writer: any,
  runs: number,
  event: any,
  context: any
) {
  let maxId: string | null = null;
  let _continue = true;
  for (let currentRun: number = 0; _continue; currentRun++) {
    console.log("Running save top entities run number", currentRun, "maxId", maxId);

    const response: RecentResults = await this(bearerToken, maxId, event);

    console.log("Got", response.statuses.length, "results from twitter");

    // Max id to page to the next result
    maxId = response.search_metadata.next_results ? extractMaxId(response.search_metadata.next_results) : null;

    // Filtering bots
    let statuses = filterStatusesForBots(response.statuses);

    console.log("---- Inserting tweets ----");
    const onlyNewStatuses = await insertTweets(statuses);

    if (currentRun === 0) {
      console.log("---- Processing entities ----");
      await setProcessedEntities();
    }

    console.log("---- Upsert entities ----");
    await upsertEntities(onlyNewStatuses);

    console.log("---- Writing result ----");
    await writer(statuses, event);

    _continue = currentRun < runs && onlyNewStatuses.length > 0;
  }

  console.log("Finish save top entities run number");

  return success("OK");
}

// --

const _cleanAndSavePeriodTopEntities = async () => {
  console.log("---- Save Period Top Entities ----");
  await _writePeriodTopEntities(PERIOD_TOP_ENTITIES_PATH, EXCLUDED_ENTITIES_STRING);
  console.log("---- Truncating entities ----");
  await truncateData();
};

const _cleanAndSavePeriodTopEntitiesWithoutRetweets = async () => {
  console.log("---- Save Period Top Entities Without Retweets ----");
  await _writePeriodTopEntities(PERIOD_TOP_ENTITIES_WITHOUT_RETWEETS_PATH, EXCLUDED_ENTITIES_STRING);
  console.log("---- Truncating entities ----");
  await truncateData();
};

const _cleanAndSavePeriodTopEntitiesOfList = async (event: any) => {
  console.log("---- Save Period Top Entities Of List ----");
  const listId = event.pathParameters.listId;
  await _writePeriodTopEntities(PERIOD_TOP_ENTITIES_OF_LIST_PATH.replace("$LIST_ID", listId), "");
  console.log("---- Truncating entities ----");
  await truncateData();
};

// ############ INTERNALS #############

function filterStatusesForBots(statuses: Array<Status>): Array<Status> {
  if (statuses) {
    return statuses.filter((status: Status) => {
      return (
        new Date(status.user.created_at).getTime() < new Date().getTime() - (MONTH * 6) &&
        status.user.followers_count > 10 &&
        !status.user.default_profile_image
      );
    });
  }

  return [];
}

async function _writePeriodTopEntities(path: string, excludeEntities: string) {
  const yesterdayTopEntities = await savePeriodTopEntities(excludeEntities);
  const weeklyTopEntities = await fetchWeeklyTopEntities(excludeEntities);
  console.log("---- Write Period Top Entities ----");
  await writePeriodTopEntities(yesterdayTopEntities, weeklyTopEntities, path);
}

const extractMaxId = (next_results: string) => {
  const queryParameters: any = new URL(`http://localhost${next_results}`);
  return queryParameters.searchParams.get("max_id");
};

const insertTweets = async (statuses: Array<Status>) => {
  const result: Array<string> = db
    .prepare(`select * from tweets where id in (${statuses.map((s) => `'${s.id_str}'`).join(",")})`)
    .all()
    .map((t) => t.id);

  statuses = statuses.filter((s: Status) => !result.includes(s.id_str));

  const tweetsStatement = db.prepare("insert into tweets values (?)");

  console.log("Inserting", statuses.length, "Tweets");

  db.transaction((statuses: Array<Status>) => {
    statuses.forEach((status: Status) => {
      tweetsStatement.run(status.id_str);
    });
  })(statuses);

  return statuses;
};

const setProcessedEntities = async () => {
  const result = db
    .prepare(
      "update entities set processed = count, lastUpdateTime = datetime() where not IFNULL(processed, -1) = count"
    )
    .run();

  console.log(result.changes, " entities were updated");
  return result;
};

const upsertEntities = async (statuses: Array<Status>) => {
  const entitiesToSave: Array<Entity> = [];

  statuses.forEach((status: Status) => {
    let entities: Entities = {
      hashtags: [],
      symbols: [],
      urls: [],
      user_mentions: [],
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
          count: 1,
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
          count: 1,
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
          count: 1,
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
            count: 1,
          });
        }
      });
  });

  const entitiesStatement = db.prepare(
    `Insert INTO entities(type,name,count,lastUpdateTime,extra) values (?,?,?,datetime(),?)
            ON CONFLICT (type,name) DO UPDATE SET count = count + ?, lastUpdateTime = datetime()`
  );

  console.log("Going over", entitiesToSave.length, "entities");
  console.log(entitiesToSave.filter((e: Entity) => EXCLUDED_ENTITIES.includes(e.name)).length, "entities are filtered");

  db.transaction((entities: Array<Entity>) => {
    entities.forEach((entity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count, entity.extra, entity.count);
    });
  })(entitiesToSave);

  console.log("done upsertEntities");
};

const writeUserListItemsToDisk = async (statuses: Array<Status>, event: any) => {
  await writeActiveUsersToDisk(statuses, event);
  const listId = event.pathParameters.listId;
  await writeTopEntitiesToDisk(TOP_ENTITIES_OF_LIST_PATH.replace("$LIST_ID", listId), "");
};

const writeActiveUsersToDisk = async (statuses: Array<Status>, event: any) => {
  const listId = event.pathParameters.listId;

  const usersMap: any = {};
  statuses.forEach((status: Status) => {
    usersMap[status.user.screen_name] = status.user;
  });

  const users: Array<UserResponse> = (Object.values(usersMap) as Array<User>).slice(0, 25).map((user: User) => {
    return {
      displayName: user.name,
      name: user.name,
      following: user.friends_count,
      followers: user.followers_count,
      profileImage: user.profile_image_url_https,
    };
  });

  await fs.writeJson(ACTIVE_USERS_PATH.replace("$LIST_ID", listId), users);
};

const writeTopEntitiesToDisk = async (path: string, excludeEntities: string) => {
  const topEntities = await fetchTopEntities(30, excludeEntities);
  await fs.writeJson(path, topEntities);
};

const fetchTopEntities = async (limit: number, excludeEntities: string): Promise<EntitiesResult> => {
  const prepareStatement = `select processed, count, name, extra, lastUpdateTime from entities where type = ?
       and not name COLLATE NOCASE in (${excludeEntities}) order by processed desc, count desc limit ${limit}`;

  const hashtags = db.prepare(prepareStatement).all(EntityType.HASHTAG);
  const cashtags = db.prepare(prepareStatement).all(EntityType.CASHHASH);
  const mentions = db.prepare(prepareStatement).all(EntityType.MENTION);
  const urls = db.prepare(prepareStatement).all(EntityType.URL);

  return {
    hashtags,
    cashtags,
    mentions,
    urls,
  };
};

const savePeriodTopEntities = async (excludeEntities: string) => {
  const preparedStatement = `select type, count, name, extra from entities where type = ? 
    and not name COLLATE NOCASE in (${excludeEntities}) order by count desc`;

  const yesterdayTopEntities: Array<TopEntity> = [
    db.prepare(preparedStatement).get(EntityType.HASHTAG),
    db.prepare(preparedStatement).get(EntityType.CASHHASH),
    db.prepare(preparedStatement).get(EntityType.MENTION),
    db.prepare(preparedStatement).get(EntityType.URL),
  ].filter((e) => !!e);

  const entitiesStatement = db.prepare("Insert INTO top_entities(type,name,count,extra,date) values (?,?,?,?,date())");

  db.transaction((entities: Array<TopEntity>) => {
    entities.forEach((entity: TopEntity) => {
      entitiesStatement.run(entity.type, entity.name, entity.count, entity.extra);
    });
  })(yesterdayTopEntities);

  return yesterdayTopEntities;
};

const fetchWeeklyTopEntities = async (excludeEntities: string) => {
  const preparedStatement = `select type, count, name, extra from top_entities where 
        date > (SELECT DATETIME('now', '-7 day')) and type = ? and not name COLLATE NOCASE in (${excludeEntities}) order by count desc`;

  const weeklyTopEntities: Array<TopEntity> = [
    db.prepare(preparedStatement).get(EntityType.HASHTAG),
    db.prepare(preparedStatement).get(EntityType.CASHHASH),
    db.prepare(preparedStatement).get(EntityType.MENTION),
    db.prepare(preparedStatement).get(EntityType.URL),
  ];

  return weeklyTopEntities;
};

const writePeriodTopEntities = async (
  yesterdayTopEntities: Array<TopEntity>,
  weeklyTopEntities: Array<TopEntity>,
  path: string
) => {
  await fs.writeJson(path, {
    yesterdayTopEntities,
    weeklyTopEntities,
  });
};

const truncateData = async () => {
  db.prepare("DELETE FROM entities").run();
  db.prepare("DELETE FROM tweets").run();
  db.exec("VACUUM;");
};

// ############ WRAPPERS #############

function success(result: any, _continue?: boolean) {
  const response: any = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(result),
  };

  if (_continue !== undefined) {
    response.continue = _continue;
  }

  return response;
}

async function beforeRunningFunc(this: any, dbPrefix: string | null, event: any, context: any) {
  const listId = event.pathParameters ? event.pathParameters.listId : null;
  if (listId && listId !== "1413118800363458560") {
    return success("Currently only 1413118800363458560 list is supported");
  }
  ensureDBIsReady(listId || dbPrefix || "all");
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
      body: "Unauthorized",
    };
  }
}

// ---------- READERS -----------

export const reader_fetchTopEntitiesWithoutRetweets = catchErrors.bind(
  beforeRunningFunc.bind(_fetchTopEntitiesWithoutRetweets, DB_SUFFIX_WITHOUT_RETWEETS)
);
export const reader_fetchTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchTopEntities, null));
export const reader_fetchTopEntitiesOfList = catchErrors.bind(beforeRunningFunc.bind(_fetchTopEntitiesOfList, null));

// --

export const reader_fetchActiveUsersOfList = catchErrors.bind(beforeRunningFunc.bind(_fetchActiveUsersOfList, null));

// --

export const reader_fetchPeriodTopEntitiesWithoutRetweets = catchErrors.bind(
  beforeRunningFunc.bind(_fetchPeriodTopEntitiesWithoutRetweets, DB_SUFFIX_WITHOUT_RETWEETS)
);
export const reader_fetchPeriodTopEntities = catchErrors.bind(beforeRunningFunc.bind(_fetchPeriodTopEntities, null));
export const reader_fetchPeriodTopEntitiesOfList = catchErrors.bind(
  beforeRunningFunc.bind(_fetchPeriodTopEntitiesOfList, null)
);

// --

export const reader_fetchTweetsByTag = catchErrors.bind(
  _fetchTweetsByTag.bind(null, SECRETS.TWEETS_BY_TAG_BEARER_TOKEN)
);

// ---------- WRITERS -----------

export const writer_saveTopEntitiesByAllWithoutRetweets = catchErrors.bind(
  beforeRunningFunc.bind(
    _saveTopEntities.bind(
      _getAllTweetsWithoutRetweets,
      SECRETS.BEARER_TOKEN,
      writeTopEntitiesToDisk.bind(null, TOP_ENTITIES_WITHOUT_RETWEETS_PATH, EXCLUDED_ENTITIES_STRING, true),
      20 // Runs
    ),
    DB_SUFFIX_WITHOUT_RETWEETS
  )
);
export const writer_saveTopEntitiesByAll = catchErrors.bind(
  beforeRunningFunc.bind(
    _saveTopEntities.bind(
      _getAllTweets,
      SECRETS.BEARER_TOKEN,
      writeTopEntitiesToDisk.bind(null, TOP_ENTITIES_PATH, EXCLUDED_ENTITIES_STRING, true),
      20 // Runs
    ),
    null
  )
);
export const writer_saveTopEntitiesByList = catchErrors.bind(
  beforeRunningFunc.bind(
    _saveTopEntities.bind(
      _getTweetsOfList,
      SECRETS.USERS_BEARER_TOKEN,
      writeUserListItemsToDisk,
      10 // Runs
    ),
    null
  )
);

// --

export const writer_cleanAndSavePeriodTopEntitiesWithoutRetweets = catchErrors.bind(
  beforeRunningFunc.bind(_cleanAndSavePeriodTopEntitiesWithoutRetweets, DB_SUFFIX_WITHOUT_RETWEETS)
);
export const writer_cleanAndSavePeriodTopEntities = catchErrors.bind(
  beforeRunningFunc.bind(_cleanAndSavePeriodTopEntities, null)
);
export const writer_cleanAndSavePeriodTopEntitiesOfList = catchErrors.bind(
  beforeRunningFunc.bind(_cleanAndSavePeriodTopEntitiesOfList, null)
);

// --

export const writer_cleanDB = catchErrors.bind(authorize.bind(beforeRunningFunc.bind(_cleanDB)));
