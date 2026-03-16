import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const databaseProviders: Provider[] = [
  {
    provide: 'PG_POOL',
    inject: [ConfigService],
    useFactory: (configService: ConfigService): Pool => {
      return new Pool({
        host: configService.get<string>('POSTGRES_HOST', 'localhost'),
        port: configService.get<number>('POSTGRES_PORT', 5432),
        user: configService.get<string>('POSTGRES_USER', 'banking'),
        password: configService.get<string>('POSTGRES_PASSWORD', 'banking'),
        database: configService.get<string>('POSTGRES_DB', 'banking'),
      });
    },
  },
];
