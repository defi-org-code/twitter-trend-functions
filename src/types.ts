export type User = {
  followers_count: number;
  friends_count: number;
  statuses_count: number;
  verified: boolean;
  default_profile_image: boolean;
  created_at: string;
  profile_image_url_https: string;
};

export type Entities = {
  hashtags: Array<{
    text: string;
  }>;
  symbols: Array<{
    text: string;
  }>;
  user_mentions: Array<{
    screen_name: string;
    name: string;
  }>;
  urls: Array<{
    url: string;
    expanded_url: string;
  }>;
};

export type Status = {
  full_text: string;
  id_str: string;
  entities: Entities;
  user: User;
  retweeted_status: Status;
  quoted_status: Status;
  is_quote_status: boolean;
  retweet_count: number;
};

export type RecentResults = {
  statuses: Array<Status>;
  search_metadata: {
    next_results: string;
  };
};

type BaseEntity = {
  type: EntityType;
  name: string;
  count: number;
  extra?: string;
};

export interface Entity extends BaseEntity {
  lastUpdateTime?: Date;
}

export interface TopEntity extends BaseEntity {
  date: Date;
}

export type EntitiesResult = {
  hashtags: Array<Entity>;
  cashtags: Array<Entity>;
  mentions: Array<Entity>;
  urls: Array<Entity>;
};

export enum EntityType {
  CASHHASH,
  HASHTAG,
  URL,
  MENTION,
}
