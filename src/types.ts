export type Tweet = {
  id: string;
  counterToUpdate: number;
  entities: {
    mentions: Array<{
      username: string;
    }>;
    hashtags: Array<{
      tag: string;
    }>;
    urls: Array<{
      url: string;
      expanded_url: string;
      display_url: string;
    }>;
    cashtags: Array<{
      tag: string;
    }>;
  };
  public_metrics: {
    retweet_count: number;
    quote_count: number;
  };
};

type BaseEntity = {
  type: EntityType;
  name: string;
  count: number;
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
