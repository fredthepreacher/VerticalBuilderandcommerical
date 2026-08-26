'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Info, Plus, Receipt, Trash2 } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { deleteJobCost, saveJobCost } from '@/app/ops/actions/finance'
import { formatCents } from '@/lib/ops/utils/money'
import { formatDate } from '@/lib/ops/utils/dates'
import {
  COST_CATEGORIES, COST_CATEGORY_LABELS, INVOICE_STATUS_LABELS,
  type CostCategory, type InvoiceStatusValue,
} from '@/lib/ops/types'
import { PROFIT_DISCLAIMER, type Profitability } from '@/lib/ops/finance/calc'
import { Badge } from './StatusBadge'

export interface CostRow {
  id: string
  category: CostCategory
  description: string
  amountCents: number
  costDate: string
  vendorName: string | null
  documentId: string | null
}

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  status: InvoiceStatusValue
  issueDate: string
  totalCents: number
  paidCents: number
  balanceCents: number
}

/**
 * The job's money in one place: what was contracted, what has been billed,
 * what has been paid, what it cost, and what is left.
 *
 * Cost visibility and profit visibility are separate permissions — a project
 * manager can often be trusted to log a receipt without being shown the
 * company's margin, and the client can configure exactly that.
 */
export default function JobFinancials({
  projectId,
  profitability,
  invoices,
  costs,
  vendors,
  canViewCosts,
  canEditCosts,
  canViewProfit,
  canCreateInvoice,
  approvedEstimates,
}: {
  projectId: string
  profitability: Profitability
  invoices: InvoiceRow[]
  costs: CostRow[]
  vendors: { id: string; label: string }[]
  canViewCosts: boolean
  canEditCosts: boolean
  canViewProfit: boolean
  canCreateInvoice: boolean
  approvedEstimates: { id: string; label: string }[]
}) {
  const [showCostForm, setShowCostForm] = useState(false)
  const [pending, startTransition] = useTransition()

  const profit = profitability.grossProfitCents
  const margin = profitability.grossMarginPercent

  return (
    <div className="ops-stack">
      {/* ---- headline numbers ------------------------------------------- */}
      <section className="ops-card">
        <div className="ops-card-head">
          <h2>Job financials</h2>
          <div className="ops-card-actions">
            {canCreateInvoice && (
              <>
                {approvedEstimates.length > 0 && (
                  <Link className="ops-btn ops-btn-sm"
                    href={`/ops/invoices/new?project=${projectId}&estimate=${approvedEstimates[0].id}`}>
                    Invoice from estimate
                  </Link>
                )}
                <Link className="ops-btn ops-btn-sm ops-btn-primary" href={`/ops/invoices/new?project=${projectId}`}>
                  <Receipt aria-hidden="true" /> New invoice
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="ops-card-body">
          <dl className="ops-finance-grid">
            <div className="ops-finance-cell">
              <dt>Contract</dt>
              <dd>{profitability.contractAmountCents !== null
                ? formatCents(profitability.contractAmountCents) : '—'}</dd>
              {profitability.contractAmountCents === null && <small>Not set on the job</small>}
            </div>

            <div className="ops-finance-cell">
              <dt>Invoiced</dt>
              <dd>{formatCents(profitability.invoicedCents)}</dd>
            </div>

            <div className="ops-finance-cell">
              <dt>Paid</dt>
              <dd>{formatCents(profitability.paidCents)}</dd>
            </div>

            <div className={`ops-finance-cell${profitability.outstandingCents > 0 ? ' is-loss' : ''}`}>
              <dt>Outstanding</dt>
              <dd>{formatCents(profitability.outstandingCents)}</dd>
            </div>

            {canViewCosts ? (
              <div className="ops-finance-cell">
                <dt>Job costs</dt>
                <dd>{formatCents(profitability.totalCostCents)}</dd>
                <small>{costs.length} entr{costs.length === 1 ? 'y' : 'ies'}</small>
              </div>
            ) : (
              // Never render $0.00 here. A hidden cost total and a genuinely
              // zero-cost job look identical, and the reader has no way to tell
              // which one they are looking at.
              <div className="ops-finance-cell is-muted">
                <dt>Job costs</dt>
                <dd>Hidden</dd>
                <small>Your role does not show job costs.</small>
              </div>
            )}

            {canViewProfit ? (
              <>
                <div className={`ops-finance-cell${
                  profit === null ? ' is-muted' : profit >= 0 ? ' is-profit' : ' is-loss'
                }`}>
                  <dt>Job gross profit</dt>
                  <dd>{profit === null ? '—' : formatCents(profit)}</dd>
                  {profit === null && <small>{profitability.unavailableReason}</small>}
                </div>
                <div className={`ops-finance-cell${
                  margin === null ? ' is-muted' : margin >= 0 ? ' is-profit' : ' is-loss'
                }`}>
                  <dt>Gross margin</dt>
                  <dd>{margin === null ? '—' : `${margin.toFixed(1)}%`}</dd>
                </div>
              </>
            ) : (
              <div className="ops-finance-cell is-muted">
                <dt>Job gross profit</dt>
                <dd>Hidden</dd>
                <small>Your role does not show profitability.</small>
              </div>
            )}
          </dl>

          {canViewProfit && (
            <p className="ops-disclaimer" style={{ marginTop: 14 }}>
              <Info aria-hidden="true" style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
              {PROFIT_DISCLAIMER}
            </p>
          )}
        </div>
      </section>

      {/* ---- invoices ---------------------------------------------------- */}
      <section className="ops-card">
        <div className="ops-card-head"><h2>Invoices</h2></div>
        {invoices.length === 0 ? (
          <div className="ops-card-body"><p className="ops-hint">Nothing invoiced yet.</p></div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Invoice</th><th>Issued</th><th className="num">Total</th>
                  <th className="num">Paid</th><th className="num">Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td data-label="Invoice" className="ops-cell-primary">
                      <Link className="ops-row-link" href={`/ops/invoices/${invoice.id}`}>
                        {invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td data-label="Issued" className="nowrap">{formatDate(invoice.issueDate)}</td>
                    <td data-label="Total" className="num">{formatCents(invoice.totalCents)}</td>
                    <td data-label="Paid" className="num">{formatCents(invoice.paidCents)}</td>
                    <td data-label="Balance" className="num"><strong>{formatCents(invoice.balanceCents)}</strong></td>
                    <td data-label="Status">
                      <Badge tone={
                        invoice.status === 'paid' ? 'ok'
                        : invoice.status === 'overdue' ? 'bad'
                        : invoice.status === 'partially_paid' ? 'warn'
                        : invoice.status === 'void' ? 'neutral' : 'info'
                      }>
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- costs -------------------------------------------------------- */}
      <section className="ops-card">
        <div className="ops-card-head">
          <h2>Job costs</h2>
          <div className="ops-card-actions">
            {canEditCosts && (
              <button type="button" className="ops-btn ops-btn-sm" onClick={() => setShowCostForm(s => !s)}>
                <Plus aria-hidden="true" /> Add cost
              </button>
            )}
          </div>
        </div>

        <div className="ops-card-body">
          {Object.keys(profitability.costsByCategory).length > 0 && (
            <div className="ops-chips" style={{ marginBottom: 14 }}>
              {COST_CATEGORIES
                .filter(c => profitability.costsByCategory[c])
                .map(category => (
                  <span key={category} className="ops-chip">
                    {COST_CATEGORY_LABELS[category]} · {formatCents(profitability.costsByCategory[category])}
                  </span>
                ))}
            </div>
          )}

          {showCostForm && canEditCosts && (
            <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--ops-line)' }}>
              <ActionForm action={saveJobCost} encType="multipart/form-data">
                {state => (
                  <>
                    <input type="hidden" name="project_id" value={projectId} />
                    <div className="ops-grid-3">
                      <div className="ops-field">
                        <label htmlFor="cost-category">Category</label>
                        <select id="cost-category" name="category" className="ops-select" defaultValue="materials">
                          {COST_CATEGORIES.map(c => (
                            <option key={c} value={c}>{COST_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="ops-field">
                        <label htmlFor="cost-amount">Amount ($)</label>
                        <input id="cost-amount" name="amount" className="ops-input" inputMode="decimal"
                          placeholder="0.00" required />
                        {state.fieldErrors?.amount_cents && (
                          <p className="ops-error">{state.fieldErrors.amount_cents[0]}</p>
                        )}
                      </div>
                      <div className="ops-field">
                        <label htmlFor="cost-date">Date</label>
                        <input id="cost-date" name="cost_date" type="date" className="ops-input"
                          defaultValue={new Date().toISOString().slice(0, 10)} required />
                      </div>
                    </div>

                    <div className="ops-field">
                      <label htmlFor="cost-desc">Description</label>
                      <input id="cost-desc" name="description" className="ops-input" required
                        placeholder="Shingles and underlayment — ABC Supply invoice 88213" />
                      {state.fieldErrors?.description && (
                        <p className="ops-error">{state.fieldErrors.description[0]}</p>
                      )}
                    </div>

                    <div className="ops-grid-2">
                      <div className="ops-field">
                        <label htmlFor="cost-vendor">Vendor</label>
                        <select id="cost-vendor" name="vendor_id" className="ops-select" defaultValue="">
                          <option value="">Not a vendor cost</option>
                          {vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </div>
                      <div className="ops-field">
                        <label htmlFor="cost-receipt">Receipt</label>
                        <input id="cost-receipt" name="receipt" type="file" className="ops-input"
                          accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" />
                        <p className="ops-hint">Photograph the receipt now — it will not get filed later.</p>
                      </div>
                    </div>

                    <SubmitButton className="ops-btn ops-btn-primary">Record cost</SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
          )}

          {!canViewCosts ? (
            <p className="ops-hint">
              Job costs are not visible to your role. This is not an empty list — the rows are
              filtered out of the query by the database, so nothing here is a count of zero.
            </p>
          ) : costs.length === 0 ? (
            <p className="ops-hint">
              No costs recorded. Without them the profit figure above is just the contract amount,
              which is not useful to anyone.
            </p>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Date</th><th>Category</th><th>Description</th><th>Vendor</th>
                    <th className="num">Amount</th><th />
                  </tr>
                </thead>
                <tbody>
                  {costs.map(cost => (
                    <tr key={cost.id}>
                      <td data-label="Date" className="nowrap">{formatDate(cost.costDate)}</td>
                      <td data-label="Category">
                        <Badge tone="neutral">{COST_CATEGORY_LABELS[cost.category]}</Badge>
                      </td>
                      <td data-label="Description" className="ops-cell-primary">{cost.description}</td>
                      <td data-label="Vendor">{cost.vendorName ?? '—'}</td>
                      <td data-label="Amount" className="num"><strong>{formatCents(cost.amountCents)}</strong></td>
                      <td className="ops-actions">
                        {cost.documentId && (
                          <a className="ops-btn ops-btn-sm" href={`/api/documents/${cost.documentId}/download`}
                            rel="noopener" title="Open the receipt">
                            <Receipt aria-hidden="true" />
                          </a>
                        )}
                        {canEditCosts && (
                          <button type="button" className="ops-btn ops-btn-sm ops-btn-danger" disabled={pending}
                            aria-label={`Remove cost: ${cost.description}`}
                            onClick={() => startTransition(async () => { await deleteJobCost(cost.id, projectId) })}>
                            <Trash2 aria-hidden="true" style={{ width: 13, height: 13 }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 650 }}>Total costs</td>
                    <td className="num"><strong>{formatCents(profitability.totalCostCents)}</strong></td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
