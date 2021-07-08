// Search for Tweets within the past seven days
// https://developer.twitter.com/en/docs/twitter-api/tweets/search/quick-start/recent-search

import needle from "needle";
import { RecentResults, Status } from "./types";

export const getRecentTweets = async (
  bearerToken: string,
  count: number = 100,
  max_id?: string | null,
  filter?: string,
  sinceId?: string
) => {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  // Edit query parameters below
  // specify a search query, and any additional fields that are required
  // by default, only the Tweet ID and text fields are returned
  const params: any = {
    q: `${filter} since:${todayUTC.toISOString().substring(0, 10)}`,
    result_type: "recent",
    include_entities: true,
    tweet_mode: "extended",
    count: count,
  };

  if (max_id) {
    params.max_id = max_id;
  }

  if (sinceId) {
    params.since_id = sinceId;
  }

  const res = await needle("get", "https://api.twitter.com/1.1/search/tweets.json", params, {
    headers: {
      "User-Agent": "v2RecentSearchJS",
      authorization: `Bearer ${bearerToken}`,
    },
  });

  if (res.body) {
    return res.body;
  } else {
    throw new Error("Unsuccessful request");
  }
};

export const getRecentTweetsOfList = async (
  bearerToken: string,
  count: number = 200,
  listId: string,
  max_id?: string | null,
  sinceId?: string
) => {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  // Edit query parameters below
  // specify a search query, and any additional fields that are required
  // by default, only the Tweet ID and text fields are returned
  const params: any = {
    list_id: listId,
    count: count,
    include_rts: true,
    include_entities: true,
    tweet_mode: "extended",
  };

  if (max_id) {
    params.max_id = max_id;
  }

  if (sinceId) {
    params.since_id = sinceId;
  }

  const res = await needle("get", "https://api.twitter.com/1.1/lists/statuses.json", params, {
    headers: {
      "User-Agent": "v2RecentSearchJS",
      authorization: `Bearer ${bearerToken}`,
    },
  });

  if (res.body) {
    const statuses: Array<Status> = (res.body as Array<Status>).filter(
      (status) => new Date(status.created_at) > todayUTC
    );

    const recentResults: RecentResults = {
      statuses: statuses,
      search_metadata: {
        next_results: statuses.length ? `?max_id=${statuses[statuses.length - 1].id_str}` : null,
      },
    };

    return recentResults;
  } else {
    throw new Error("Unsuccessful request");
  }
};
