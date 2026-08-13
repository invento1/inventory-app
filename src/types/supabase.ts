export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      areas: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          region: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_memo_items: {
        Row: {
          created_at: string
          credit_memo_id: string
          id: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          credit_memo_id: string
          id?: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          credit_memo_id?: string
          id?: string
          item_id?: string
          line_total?: number
          location_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_memo_items_credit_memo_id_fkey"
            columns: ["credit_memo_id"]
            isOneToOne: false
            referencedRelation: "credit_memos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_memo_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_memo_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_memos: {
        Row: {
          created_at: string
          created_by: string | null
          credit_memo_number: string
          customer_id: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_memo_number: string
          customer_id: string
          id?: string
          issue_date?: string
          notes?: string | null
          org_id: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_memo_number?: string
          customer_id?: string
          id?: string
          issue_date?: string
          notes?: string | null
          org_id?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_memos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_memos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          area_id: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          area_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          area_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          deposit_date: string
          deposit_number: string
          id: string
          memo: string | null
          org_id: string
          total: number
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          deposit_date?: string
          deposit_number: string
          id?: string
          memo?: string | null
          org_id: string
          total?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          deposit_date?: string
          deposit_number?: string
          id?: string
          memo?: string | null
          org_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "deposits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "deposits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_number_counters: {
        Row: {
          doc_type: string
          next_number: number
          org_id: string
        }
        Insert: {
          doc_type: string
          next_number?: number
          org_id: string
        }
        Update: {
          doc_type?: string
          next_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_number_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_id: string | null
          amount: number
          category_account_id: string
          created_at: string
          created_by: string | null
          expense_date: string
          expense_number: string
          id: string
          notes: string | null
          org_id: string
          payee_name: string | null
          payee_supplier_id: string | null
          payment_method: string
          reference_number: string | null
          status: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_account_id: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          expense_number: string
          id?: string
          notes?: string | null
          org_id: string
          payee_name?: string | null
          payee_supplier_id?: string | null
          payment_method: string
          reference_number?: string | null
          status?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_account_id?: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          expense_number?: string
          id?: string
          notes?: string | null
          org_id?: string
          payee_name?: string | null
          payee_supplier_id?: string | null
          payment_method?: string
          reference_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_account_id_fkey"
            columns: ["category_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "expenses_category_account_id_fkey"
            columns: ["category_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payee_supplier_id_fkey"
            columns: ["payee_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          item_id?: string
          line_total?: number
          location_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deposit_id: string | null
          id: string
          invoice_id: string
          notes: string | null
          org_id: string
          paid_at: string
          payment_method: string
          reference_number: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deposit_id?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          org_id: string
          paid_at?: string
          payment_method: string
          reference_number?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deposit_id?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string
          payment_method?: string
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          due_date: string
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          org_id: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          due_date?: string
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          org_id?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          barcode: string | null
          brand_id: string | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          reorder_threshold: number | null
          sku: string
          supplier_id: string | null
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          reorder_threshold?: number | null
          sku: string
          supplier_id?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          reorder_threshold?: number | null
          sku?: string
          supplier_id?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          entry_number: string
          id: string
          memo: string | null
          org_id: string
          reference_id: string | null
          reference_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          memo?: string | null
          org_id: string
          reference_id?: string | null
          reference_type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          memo?: string | null
          org_id?: string
          reference_id?: string | null
          reference_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          credit: number
          debit: number
          id: string
          journal_entry_id: string
          line_order: number
          memo: string | null
          name: string | null
        }
        Insert: {
          account_id: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id: string
          line_order?: number
          memo?: string | null
          name?: string | null
        }
        Update: {
          account_id?: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id?: string
          line_order?: number
          memo?: string | null
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          parent_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          parent_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          parent_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "ledger_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          type: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          type?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          address: string | null
          created_at: string
          currency_code: string
          currency_symbol: string
          email: string | null
          id: string
          name: string
          phone: string | null
          slug: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          slug: string
        }
        Update: {
          address?: string | null
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          slug?: string
        }
        Relationships: []
      }
      price_lists: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          list_date: string
          list_type: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          list_date?: string
          list_type?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          list_date?: string
          list_type?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          po_id: string
          quantity_ordered: number
          quantity_received: number
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          po_id: string
          quantity_ordered: number
          quantity_received?: number
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          po_id?: string
          quantity_ordered?: number
          quantity_received?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          bill_id: string | null
          created_at: string
          created_by: string | null
          expected_date: string | null
          id: string
          org_id: string
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          org_id: string
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          org_id?: string
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "outstanding_supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_total: number
          quantity: number
          quotation_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_total: number
          quantity: number
          quotation_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_total?: number
          quantity?: number
          quotation_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          expiry_date: string | null
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          quotation_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          org_id: string
          quotation_number: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          org_id?: string
          quotation_number?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          org_id: string
          payment_method: string
          reference_number: string | null
          refund_date: string
          refund_number: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          org_id: string
          payment_method: string
          reference_number?: string | null
          refund_date?: string
          refund_number: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          org_id?: string
          payment_method?: string
          reference_number?: string | null
          refund_date?: string
          refund_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "refunds_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_receipt_items: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          sales_receipt_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          sales_receipt_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_total?: number
          location_id?: string
          quantity?: number
          sales_receipt_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_receipt_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_receipt_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_receipt_items_sales_receipt_id_fkey"
            columns: ["sales_receipt_id"]
            isOneToOne: false
            referencedRelation: "sales_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_receipts: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          notes: string | null
          org_id: string
          payment_method: string
          receipt_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          payment_method: string
          receipt_number: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          payment_method?: string
          receipt_number?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_receipts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_levels: {
        Row: {
          item_id: string
          location_id: string
          org_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          item_id: string
          location_id: string
          org_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          item_id?: string
          location_id?: string
          org_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          location_id: string
          notes: string | null
          org_id: string
          quantity_delta: number
          reason: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          location_id: string
          notes?: string | null
          org_id: string
          quantity_delta: number
          reason: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          location_id?: string
          notes?: string | null
          org_id?: string
          quantity_delta?: number
          reason?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bill_items: {
        Row: {
          bill_id: string
          created_at: string
          id: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          bill_id: string
          created_at?: string
          id?: string
          item_id: string
          line_total: number
          location_id: string
          quantity: number
          unit_cost: number
        }
        Update: {
          bill_id?: string
          created_at?: string
          id?: string
          item_id?: string
          line_total?: number
          location_id?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "outstanding_supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bill_payments: {
        Row: {
          account_id: string | null
          amount: number
          bill_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          org_id: string
          paid_at: string
          payment_method: string
          reference_number: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          bill_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          org_id: string
          paid_at?: string
          payment_method: string
          reference_number?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          bill_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string
          payment_method?: string
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "outstanding_supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          amount_paid: number
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          bill_number: string
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          issue_date?: string
          notes?: string | null
          org_id: string
          purchase_order_id?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          bill_number?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          issue_date?: string
          notes?: string | null
          org_id?: string
          purchase_order_id?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          abbreviation: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_of_measure_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      all_transactions: {
        Row: {
          doc_id: string | null
          doc_number: string | null
          doc_type: string | null
          org_id: string | null
          party_name: string | null
          status: string | null
          total: number | null
          txn_date: string | null
        }
        Relationships: []
      }
      item_average_purchase_price: {
        Row: {
          avg_unit_cost: number | null
          bill_count: number | null
          item_id: string | null
          org_id: string | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_account_balances: {
        Row: {
          account_id: string | null
          balance: number | null
          org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      low_stock_report: {
        Row: {
          item_id: string | null
          location_id: string | null
          org_id: string | null
          quantity: number | null
          reorder_threshold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      outstanding_invoices: {
        Row: {
          amount_paid: number | null
          balance: number | null
          customer_id: string | null
          customer_name: string | null
          due_date: string | null
          id: string | null
          invoice_number: string | null
          is_overdue: boolean | null
          issue_date: string | null
          org_id: string | null
          status: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      outstanding_supplier_bills: {
        Row: {
          amount_paid: number | null
          balance: number | null
          bill_number: string | null
          due_date: string | null
          id: string | null
          is_overdue: boolean | null
          issue_date: string | null
          org_id: string | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_customer_payment: {
        Args: {
          p_allocations: Json
          p_amount: number
          p_customer_id: string
          p_notes: string
          p_org_id: string
          p_paid_at: string
          p_payment_method: string
          p_reference_number?: string
        }
        Returns: undefined
      }
      apply_supplier_payment: {
        Args: {
          p_account_id?: string
          p_allocations: Json
          p_amount: number
          p_notes: string
          p_org_id: string
          p_paid_at: string
          p_payment_method: string
          p_reference_number?: string
          p_supplier_id: string
        }
        Returns: undefined
      }
      convert_purchase_order_to_bill: {
        Args: {
          p_due_date: string
          p_location_id: string
          p_notes?: string
          p_po_id: string
        }
        Returns: {
          amount_paid: number
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplier_bills"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_credit_memo: {
        Args: {
          p_customer_id: string
          p_lines: Json
          p_notes?: string
          p_org_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          credit_memo_number: string
          customer_id: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_memos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_expense: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_category_account_id: string
          p_expense_date: string
          p_notes?: string
          p_org_id: string
          p_payee_name: string
          p_payee_supplier_id: string
          p_payment_method: string
          p_reference_number?: string
        }
        Returns: {
          account_id: string | null
          amount: number
          category_account_id: string
          created_at: string
          created_by: string | null
          expense_date: string
          expense_number: string
          id: string
          notes: string | null
          org_id: string
          payee_name: string | null
          payee_supplier_id: string | null
          payment_method: string
          reference_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_fund_transfer: {
        Args: {
          p_amount: number
          p_from_account_id: string
          p_memo: string
          p_org_id: string
          p_to_account_id: string
          p_transfer_date: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          entry_date: string
          entry_number: string
          id: string
          memo: string | null
          org_id: string
          reference_id: string | null
          reference_type: string
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invoice: {
        Args: {
          p_customer_id: string
          p_due_date: string
          p_lines: Json
          p_notes?: string
          p_org_id: string
        }
        Returns: {
          amount_paid: number
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_journal_entry: {
        Args: {
          p_entry_date: string
          p_lines: Json
          p_memo: string
          p_org_id: string
          p_reference_id?: string
          p_reference_type?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          entry_date: string
          entry_number: string
          id: string
          memo: string | null
          org_id: string
          reference_id: string | null
          reference_type: string
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_quotation: {
        Args: {
          p_customer_id: string
          p_expiry_date: string
          p_lines: Json
          p_notes?: string
          p_org_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          expiry_date: string | null
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          quotation_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_refund: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_customer_id: string
          p_notes?: string
          p_org_id: string
          p_payment_method: string
          p_reference_number?: string
          p_refund_date?: string
        }
        Returns: {
          account_id: string | null
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          org_id: string
          payment_method: string
          reference_number: string | null
          refund_date: string
          refund_number: string
        }
        SetofOptions: {
          from: "*"
          to: "refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_sales_receipt: {
        Args: {
          p_customer_id: string
          p_lines: Json
          p_org_id: string
          p_payment_method: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          notes: string | null
          org_id: string
          payment_method: string
          receipt_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales_receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_stock_transfer: {
        Args: {
          p_from_location_id: string
          p_item_id: string
          p_notes?: string
          p_org_id: string
          p_quantity: number
          p_to_location_id: string
          p_transfer_date: string
        }
        Returns: undefined
      }
      create_supplier_bill: {
        Args: {
          p_due_date: string
          p_lines: Json
          p_notes?: string
          p_org_id: string
          p_supplier_id: string
        }
        Returns: {
          amount_paid: number
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplier_bills"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard_summary: {
        Args: { p_org_id: string }
        Returns: {
          customer_count: number
          item_count: number
          low_stock_count: number
          outstanding_ap_total: number
          outstanding_ar_total: number
          overdue_bill_count: number
          overdue_invoice_count: number
          revenue_last_week: number
          revenue_this_week: number
          today_sales_count: number
          today_sales_total: number
        }[]
      }
      get_or_create_default_account: {
        Args: { p_account_type: string; p_name: string; p_org_id: string }
        Returns: string
      }
      is_org_member: { Args: { target_org: string }; Returns: boolean }
      next_document_number: {
        Args: { p_doc_type: string; p_org_id: string; p_prefix: string }
        Returns: string
      }
      next_item_sku: { Args: { p_org_id: string }; Returns: string }
      org_role: { Args: { target_org: string }; Returns: string }
      post_journal_entry: {
        Args: {
          p_entry_date: string
          p_lines: Json
          p_memo: string
          p_org_id: string
          p_reference_id: string
          p_reference_type: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          entry_date: string
          entry_number: string
          id: string
          memo: string | null
          org_id: string
          reference_id: string | null
          reference_type: string
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profit_and_loss: {
        Args: { p_end_date: string; p_org_id: string; p_start_date: string }
        Returns: {
          account_id: string
          account_name: string
          account_type: string
          amount: number
        }[]
      }
      receive_purchase_order_line: {
        Args: {
          p_location_id: string
          p_po_line_id: string
          p_quantity: number
        }
        Returns: undefined
      }
      record_deposit: {
        Args: {
          p_account_id: string
          p_deposit_date: string
          p_memo: string
          p_org_id: string
          p_payment_ids: string[]
        }
        Returns: {
          account_id: string
          created_at: string
          created_by: string | null
          deposit_date: string
          deposit_number: string
          id: string
          memo: string | null
          org_id: string
          total: number
        }
        SetofOptions: {
          from: "*"
          to: "deposits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_invoice_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_notes?: string
          p_paid_at?: string
          p_payment_method: string
          p_reference_number?: string
        }
        Returns: {
          amount_paid: number
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_supplier_bill_payment: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_bill_id: string
          p_notes?: string
          p_paid_at?: string
          p_payment_method: string
          p_reference_number?: string
        }
        Returns: {
          amount_paid: number
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplier_bills"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_org_data: {
        Args: { p_categories: string[]; p_org_id: string }
        Returns: undefined
      }
      void_credit_memo: {
        Args: { p_credit_memo_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          credit_memo_number: string
          customer_id: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_memos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_expense: {
        Args: { p_expense_id: string }
        Returns: {
          account_id: string | null
          amount: number
          category_account_id: string
          created_at: string
          created_by: string | null
          expense_date: string
          expense_number: string
          id: string
          notes: string | null
          org_id: string
          payee_name: string | null
          payee_supplier_id: string | null
          payment_method: string
          reference_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          amount_paid: number
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          org_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_quotation: {
        Args: { p_quotation_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          expiry_date: string | null
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          quotation_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_supplier_bill: {
        Args: { p_bill_id: string }
        Returns: {
          amount_paid: number
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplier_bills"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
