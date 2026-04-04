import { Controller, Param, Post } from '@nestjs/common';
import { ProjectionRunnerService } from './projection-runner.service';

@Controller('admin/projections')
export class ProjectionAdminController {
  constructor(private readonly projectionRunner: ProjectionRunnerService) {}

  @Post('accounts/:accountId/rebuild')
  async rebuildAccount(@Param('accountId') accountId: string): Promise<{ status: string; accountId: string }> {
    await this.projectionRunner.rebuildAccount(accountId);
    return {
      status: 'rebuild-completed',
      accountId,
    };
  }

  @Post('accounts/rebuild-all')
  async rebuildAll(): Promise<{ status: string }> {
    await this.projectionRunner.rebuildAll();
    return {
      status: 'rebuild-completed',
    };
  }
}
