import { assertCompanyUser, repo, ValidationError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { employeeInput } from '../contract.ts';
import { WorkforceEmployee, WorkforceSite } from '../entities/index.ts';
import { H } from '../entities/common.ts';
import { command } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { workflowAction } from './define.ts';
async function register(ctx: Context, input: z.infer<typeof employeeInput>) {
  await assertCompanyUser(ctx, input.userId);
  const site = await repo(ctx, WorkforceSite).get(input.siteId);
  if (!site.active) throw new ValidationError('Cannot assign an inactive site', [{ path: 'siteId', message: 'Choose an active site.' }]);
  return command(await internalWrite(ctx, WorkforceEmployee, (write) => repo(write, WorkforceEmployee).create(input)));
}
export const registerEmployeeAction = workflowAction('register_employee', '会社利用者を従業員へ登録', employeeInput, [H], register, false);
