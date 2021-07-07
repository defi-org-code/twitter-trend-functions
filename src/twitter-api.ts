// Search for Tweets within the past seven days
// https://developer.twitter.com/en/docs/twitter-api/tweets/search/quick-start/recent-search

import needle from "needle";

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
