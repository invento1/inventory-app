-- Phase 4 Stage 2, part B: wire the money-moving RPCs (sales receipts,
-- invoices, invoice payments, supplier bills, supplier bill payments, and
-- their voids) to auto-post balanced journal entries. See CLAUDE.md
-- section 4's Stage 1 note -- this is the "Stage 2 will need to relax
-- create_journal_entry's role check" work flagged when Stage 1 shipped.

-- =========================================================================
-- Security note: create_journal_entry is called directly by the client
-- (Fiscal Daybook -> supabase.rpc('create_journal_entry', ...)). Making its
-- owner/admin gate conditional on reference_type would let any staff user
-- call it from the browser console with a fabricated p_reference_type to
-- bypass the gate entirely. So instead of loosening that check, the
-- validation/insert logic is extracted into a private post_journal_entry()
-- with NO role check (the caller's job) and revoked from public/
-- authenticated/anon -- it can only be invoked as a plain SQL call from
-- inside another SECURITY DEFINER function, never directly via
-- supabase.rpc(). Same technique already used for next_document_number.
-- create_journal_entry becomes a thin wrapper that keeps its existing
-- owner/admin gate and calls post_journal_entry -- unchanged behavior from
-- the client's perspective.
-- =========================================================================

create or replace function public.post_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_reference_type text,
  p_reference_id uuid
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry journal_entries%rowtype;
  v_entry_number text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_account_org uuid;
  v_order integer := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;

  select coalesce(sum((line ->> 'debit')::numeric), 0), coalesce(sum((line ->> 'credit')::numeric), 0)
  into v_total_debit, v_total_credit
  from jsonb_array_elements(p_lines) as line;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'debits (%) must equal credits (%)', v_total_debit, v_total_credit;
  end if;

  v_entry_number := next_document_number(p_org_id, 'journal_entry', 'JE');

  insert into journal_entries (org_id, entry_number, entry_date, memo, reference_type, reference_id, created_by)
  values (p_org_id, v_entry_number, p_entry_date, p_memo, coalesce(p_reference_type, 'manual'), p_reference_id, auth.uid())
  returning * into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line ->> 'account_id')::uuid;
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'each line needs either a debit or a credit, not both or neither';
    end if;

    select org_id into v_account_org from ledger_accounts where id = v_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;

    insert into journal_lines (journal_entry_id, account_id, debit, credit, name, memo, line_order)
    values (v_entry.id, v_account_id, v_debit, v_credit, v_line ->> 'name', v_line ->> 'memo', v_order);
    v_order := v_order + 1;
  end loop;

  return v_entry;
end;
$$;

revoke execute on function public.post_journal_entry(uuid, date, text, jsonb, text, uuid) from public, authenticated, anon;

create or replace function public.create_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_reference_type text default 'manual',
  p_reference_id uuid default null
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public
as $$
begin
  if org_role(p_org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can post journal entries';
  end if;
  return post_journal_entry(p_org_id, p_entry_date, p_memo, p_lines, coalesce(p_reference_type, 'manual'), p_reference_id);
end;
$$;

-- =========================================================================
-- Idempotent lookup-by-name within an org, auto-creating the account on
-- first use. Every auto-posting RPC below agrees on a fixed set of names
-- ("Cash", "Bank", "Accounts Receivable", "Accounts Payable", "Sales
-- Income", "Purchases") so there's exactly one of each per org, created
-- lazily instead of requiring an upfront setup screen. Ledger accounts are
-- only ever soft-deactivated (is_active), never deleted, so lookup-by-name
-- is safe from silently vanishing underneath a later post.
-- =========================================================================

create or replace function public.get_or_create_default_account(
  p_org_id uuid,
  p_name text,
  p_account_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from ledger_accounts where org_id = p_org_id and name = p_name;
  if v_id is null then
    insert into ledger_accounts (org_id, name, account_type, description)
    values (p_org_id, p_name, p_account_type, 'Auto-created default account')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.get_or_create_default_account(uuid, text, text) from public, authenticated, anon;

-- =========================================================================
-- create_sales_receipt: Debit Cash-or-Bank / Credit Sales Income. Skipped
-- entirely for a $0 receipt (free items) since post_journal_entry rejects
-- a zero-amount line -- same defensive guard used on every posting call
-- below.
-- =========================================================================

create or replace function public.create_sales_receipt(
  p_org_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_lines jsonb
)
returns public.sales_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, payment_method, subtotal, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_payment_method, v_subtotal, v_subtotal, auth.uid())
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'Sales receipt ' || v_receipt_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(
            p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
          ),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'sales_receipt', v_receipt.id
    );
  end if;

  return v_receipt;
end;
$$;

-- =========================================================================
-- create_invoice: Debit Accounts Receivable / Credit Sales Income.
-- =========================================================================

create or replace function public.create_invoice(
  p_org_id uuid,
  p_customer_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'Invoice ' || v_invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'invoice', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$$;

-- =========================================================================
-- record_invoice_payment: Debit Cash-or-Bank / Credit Accounts Receivable.
-- Captures the new payment row's id (returning id into v_payment_id) so
-- the posted journal entry's reference_id points at the specific payment,
-- not just the invoice.
-- =========================================================================

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if not is_org_member(v_invoice.org_id) then
    raise exception 'not a member of this org';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'cannot record a payment against a voided invoice';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  v_new_amount_paid := v_invoice.amount_paid + p_amount;

  if v_new_amount_paid > v_invoice.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_invoice.total - v_invoice.amount_paid);
  end if;

  insert into invoice_payments (org_id, invoice_id, amount, payment_method, paid_at, notes, created_by)
  values (v_invoice.org_id, p_invoice_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, auth.uid())
  returning id into v_payment_id;

  update invoices
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  perform post_journal_entry(
    v_invoice.org_id, coalesce(p_paid_at, now())::date, 'Payment for invoice ' || v_invoice.invoice_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(
          v_invoice.org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
        ),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', p_amount
      )
    ),
    'invoice_payment', v_payment_id
  );

  return v_invoice;
end;
$$;

-- =========================================================================
-- void_invoice: only reachable pre-payment (amount_paid = 0 is already
-- enforced below), so the reversal is simply the opposite of the original
-- creation entry: Credit Accounts Receivable / Debit Sales Income.
-- =========================================================================

create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_line record;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if org_role(v_invoice.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void an invoice';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'invoice is already void';
  end if;

  if v_invoice.amount_paid > 0 then
    raise exception 'cannot void an invoice with recorded payments';
  end if;

  for v_line in select * from invoice_items where invoice_id = p_invoice_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_invoice.org_id, v_line.item_id, v_line.location_id, v_line.quantity, 'void', 'invoice', v_invoice.id, auth.uid());
  end loop;

  update invoices
  set status = 'void', updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  if v_invoice.total > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Void invoice ' || v_invoice.invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', 0, 'credit', v_invoice.total
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Sales Income', 'income'),
          'debit', v_invoice.total, 'credit', 0
        )
      ),
      'invoice_void', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$$;

-- =========================================================================
-- create_supplier_bill: Debit Purchases / Credit Accounts Payable. Named
-- "Purchases" rather than "Cost of Goods Sold" -- this app has no per-item
-- cost basis or COGS matching yet (see CLAUDE.md section 10), so this is
-- honest expense recognition at bill time, not true COGS.
-- =========================================================================

create or replace function public.create_supplier_bill(
  p_org_id uuid,
  p_supplier_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_bill_number text;
  v_subtotal numeric;
  v_supplier_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_supplier_id is null then
    raise exception 'a bill requires a supplier';
  end if;

  select org_id into v_supplier_org from suppliers where id = p_supplier_id;
  if v_supplier_org is distinct from p_org_id then
    raise exception 'supplier does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'a bill requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a bill must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_cost')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_bill_number := next_document_number(p_org_id, 'supplier_bill', 'BILL');

  insert into supplier_bills (org_id, bill_number, supplier_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_bill_number, p_supplier_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_bill;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_cost < 0 then
      raise exception 'unit cost cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into supplier_bill_items (bill_id, item_id, location_id, quantity, unit_cost, line_total)
    values (v_bill.id, v_item_id, v_location_id, v_quantity, v_unit_cost, v_quantity * v_unit_cost);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'receive', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_bill.issue_date, 'Supplier bill ' || v_bill_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Purchases', 'expense'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Payable', 'accounts_payable'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'supplier_bill', v_bill.id
    );
  end if;

  return v_bill;
end;
$$;

-- =========================================================================
-- record_supplier_bill_payment: Debit Accounts Payable / Credit
-- Cash-or-Bank -- opposite direction from record_invoice_payment since
-- this pays down a liability rather than collecting against an asset.
-- =========================================================================

create or replace function public.record_supplier_bill_payment(
  p_bill_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  if not is_org_member(v_bill.org_id) then
    raise exception 'not a member of this org';
  end if;

  if v_bill.status = 'void' then
    raise exception 'cannot record a payment against a voided bill';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  v_new_amount_paid := v_bill.amount_paid + p_amount;

  if v_new_amount_paid > v_bill.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_bill.total - v_bill.amount_paid);
  end if;

  insert into supplier_bill_payments (org_id, bill_id, amount, payment_method, paid_at, notes, created_by)
  values (v_bill.org_id, p_bill_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, auth.uid())
  returning id into v_payment_id;

  update supplier_bills
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  perform post_journal_entry(
    v_bill.org_id, coalesce(p_paid_at, now())::date, 'Payment for supplier bill ' || v_bill.bill_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object(
        'account_id', get_or_create_default_account(
          v_bill.org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
        ),
        'debit', 0, 'credit', p_amount
      )
    ),
    'supplier_bill_payment', v_payment_id
  );

  return v_bill;
end;
$$;

-- =========================================================================
-- void_supplier_bill: reversal of the creation entry, Credit Purchases /
-- Debit Accounts Payable.
-- =========================================================================

create or replace function public.void_supplier_bill(p_bill_id uuid)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_line record;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  if org_role(v_bill.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void a supplier bill';
  end if;

  if v_bill.status = 'void' then
    raise exception 'bill is already void';
  end if;

  if v_bill.amount_paid > 0 then
    raise exception 'cannot void a bill with recorded payments';
  end if;

  for v_line in select * from supplier_bill_items where bill_id = p_bill_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_bill.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  update supplier_bills
  set status = 'void', updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  if v_bill.total > 0 then
    perform post_journal_entry(
      v_bill.org_id, current_date, 'Void supplier bill ' || v_bill.bill_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_bill.org_id, 'Purchases', 'expense'),
          'debit', 0, 'credit', v_bill.total
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
          'debit', v_bill.total, 'credit', 0
        )
      ),
      'supplier_bill_void', v_bill.id
    );
  end if;

  return v_bill;
end;
$$;
