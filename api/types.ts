export type QueryValue = string | string[] | undefined;

export type ApiRequest = {
  method?: string;
  query: Record<string, QueryValue>;
};

export type ApiResponse = {
  status(code: number): {
    json(body: unknown): unknown;
  };
};
