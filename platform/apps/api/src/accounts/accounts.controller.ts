import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FinancialAuthGuard } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthSubject } from '../common/auth/auth-context.js';
import { CorrelationIdInterceptor } from '../common/interceptors/correlation-id.interceptor.js';
import {
  GetAccountUseCase,
  ListCustomerAccountsUseCase,
  GetAccountBalanceUseCase,
  GetAccountTransactionsUseCase,
  PaymentAccountDto,
  AccountBalanceDto,
  PaginatedTransactionsDto,
} from '@spbk/accounts';

@Controller('api/v1/accounts')
@UseGuards(FinancialAuthGuard)
@UseInterceptors(CorrelationIdInterceptor)
export class AccountsController {
  constructor(
    private readonly getAccountUseCase: GetAccountUseCase,
    private readonly listCustomerAccountsUseCase: ListCustomerAccountsUseCase,
    private readonly getAccountBalanceUseCase: GetAccountBalanceUseCase,
    private readonly getAccountTransactionsUseCase: GetAccountTransactionsUseCase,
  ) {}

  @Get()
  async listAccounts(
    @CurrentUser() user: AuthSubject,
  ): Promise<{ data: readonly PaymentAccountDto[] }> {
    const accounts = await this.listCustomerAccountsUseCase.execute({
      subjectId: user.id,
      roles: user.roles,
      kycStatus: user.kycStatus,
    });
    return { data: accounts };
  }

  @Get(':id')
  async getAccount(
    @Param('id') id: string,
    @CurrentUser() user: AuthSubject,
  ): Promise<{ data: PaymentAccountDto }> {
    const account = await this.getAccountUseCase.execute(id, {
      subjectId: user.id,
      roles: user.roles,
      kycStatus: user.kycStatus,
    });
    return { data: account };
  }

  @Get(':id/balance')
  async getBalance(
    @Param('id') id: string,
    @CurrentUser() user: AuthSubject,
  ): Promise<{ data: AccountBalanceDto }> {
    const balance = await this.getAccountBalanceUseCase.execute(id, {
      subjectId: user.id,
      roles: user.roles,
      kycStatus: user.kycStatus,
    });
    return { data: balance };
  }

  @Get(':id/transactions')
  async getTransactions(
    @Param('id') id: string,
    @Query('limit') limitStr: string | undefined,
    @Query('offset') offsetStr: string | undefined,
    @CurrentUser() user: AuthSubject,
  ): Promise<{ data: PaginatedTransactionsDto }> {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const history = await this.getAccountTransactionsUseCase.execute(
      id,
      { limit, offset },
      {
        subjectId: user.id,
        roles: user.roles,
        kycStatus: user.kycStatus,
      },
    );
    return { data: history };
  }
}
