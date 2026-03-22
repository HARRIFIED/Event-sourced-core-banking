export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
}
