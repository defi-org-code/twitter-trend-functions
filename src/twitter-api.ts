// Search for Tweets within the past seven days
// https://developer.twitter.com/en/docs/twitter-api/tweets/search/quick-start/recent-search

import needle from "needle";

// The code below sets the bearer token from your environment variables
// To set environment variables on macOS or Linux, run the export command below from the terminal:
// export BEARER_TOKEN='YOUR-TOKEN'
const token = process.env.BEARER_TOKEN;

console.log("Loading token", token);

export const getRecentTweets = async () => {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  // Edit query parameters below
  // specify a search query, and any additional fields that are required
  // by default, only the Tweet ID and text fields are returned
  const params = {
    query: "(#defi OR #crypto OR #cryptocurrency) is:retweet",
    start_time: todayUTC.toISOString(),
    "tweet.fields": "text,public_metrics,entities,referenced_tweets",
    "user.fields": "description,public_metrics",
    expansions: "author_id,referenced_tweets.id",
    max_results: 11,
  };

  console.log("getRecentTweets token", token);
  console.log("getRecentTweets token from env", process.env.BEARER_TOKEN);

  const res = await needle("get", "https://api.twitter.com/2/tweets/search/recent", params, {
    headers: {
      "User-Agent": "v2RecentSearchJS",
      authorization: `Bearer ${token}`,
    },
  });

  if (res.body) {
    return res.body;
  } else {
    throw new Error("Unsuccessful request");
  }
};
