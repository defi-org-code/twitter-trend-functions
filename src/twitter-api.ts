// Search for Tweets within the past seven days
// https://developer.twitter.com/en/docs/twitter-api/tweets/search/quick-start/recent-search

import needle from "needle";

export const getRecentTweets = async (bearerToken: string, max_id?: string | null) => {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  // Edit query parameters below
  // specify a search query, and any additional fields that are required
  // by default, only the Tweet ID and text fields are returned
  const params: any = {
    q: `(#defi OR #crypto OR #cryptocurrency) since:${todayUTC.toISOString().substring(0, 10)}`,
    result_type: "recent",
    include_entities: true,
    tweet_mode: "extended",
    count: 100,
  };

  if (max_id) {
    params.max_id = max_id;
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
