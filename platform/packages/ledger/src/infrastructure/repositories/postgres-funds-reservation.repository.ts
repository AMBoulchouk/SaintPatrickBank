import type { Pool } from 'pg';
import { Money } from '@spbk/shared-kernel';
import type {
  IFundsReservationRepository,
  CreateReservationCommand,
  ReservationResult,
  SettleReservationCommand,
  SettleResult,
  ReleaseReservationCommand,
  ReleaseResult,
} from '../../domain/repositories/funds-reservation.repository.interface.js';
import { FundsReservation } from '../../domain/entities/funds-reservation.js';

export class PostgresFundsReservationRepository implements IFundsReservationRepository {
  constructor(private readonly pool: Pool) {}

  async getReservationById(reservationId: string): Promise<FundsReservation | null> {
    const res = await this.pool.query(
      `SELECT id, operation_id, account_id, reserved_account_id, amount_cents, currency, status,
              creation_journal_entry_id, settlement_journal_entry_id, release_journal_entry_id,
              expires_at, created_at, updated_at
       FROM ledger.funds_reservations
       WHERE id = $1`,
      [reservationId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return new FundsReservation({
      id: row.id,
      operationId: row.operation_id,
      accountId: row.account_id,
      reservedAccountId: row.reserved_account_id,
      amount: Money.fromCents(BigInt(row.amount_cents), row.currency),
      currency: row.currency,
      status: row.status,
      creationJournalEntryId: row.creation_journal_entry_id,
      settlementJournalEntryId: row.settlement_journal_entry_id,
      releaseJournalEntryId: row.release_journal_entry_id,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  async createReservation(command: CreateReservationCommand): Promise<ReservationResult> {
    const res = await this.pool.query(
      `SELECT out_reservation_id, out_operation_id, out_journal_entry_id, out_available_balance, out_reserved_balance, out_is_idempotent_replay
       FROM ledger.fn_create_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        command.clientReferenceId,
        command.requestHash,
        command.idempotencyKey,
        command.accountId,
        command.reservedAccountId,
        command.amount.amountCents.toString(),
        command.amount.currency,
        command.expiresAt.toISOString(),
        command.description,
        JSON.stringify(command.metadata ?? {}),
      ]
    );

    const row = res.rows[0];
    return {
      reservationId: row.out_reservation_id,
      operationId: row.out_operation_id,
      journalEntryId: row.out_journal_entry_id,
      availableBalance: Money.fromCents(BigInt(row.out_available_balance), command.amount.currency),
      reservedBalance: Money.fromCents(BigInt(row.out_reserved_balance), command.amount.currency),
      isIdempotentReplay: Boolean(row.out_is_idempotent_replay),
    };
  }

  async settleReservation(command: SettleReservationCommand): Promise<SettleResult> {
    const res = await this.pool.query(
      `SELECT out_operation_id, out_journal_entry_id, out_is_idempotent_replay
       FROM ledger.fn_settle_reservation($1, $2, $3, $4, $5, $6, $7)`,
      [
        command.reservationId,
        command.clientReferenceId,
        command.requestHash,
        command.idempotencyKey,
        command.destinationAccountId,
        command.settleAmount.amountCents.toString(),
        command.description,
      ]
    );

    const row = res.rows[0];
    return {
      operationId: row.out_operation_id,
      journalEntryId: row.out_journal_entry_id,
      isIdempotentReplay: Boolean(row.out_is_idempotent_replay),
    };
  }

  async releaseReservation(command: ReleaseReservationCommand): Promise<ReleaseResult> {
    const res = await this.pool.query(
      `SELECT out_operation_id, out_journal_entry_id, out_is_idempotent_replay
       FROM ledger.fn_release_reservation($1, $2, $3, $4, $5, $6)`,
      [
        command.reservationId,
        command.clientReferenceId,
        command.requestHash,
        command.idempotencyKey,
        command.reason,
        command.description,
      ]
    );

    const row = res.rows[0];
    return {
      operationId: row.out_operation_id,
      journalEntryId: row.out_journal_entry_id,
      isIdempotentReplay: Boolean(row.out_is_idempotent_replay),
    };
  }
}
