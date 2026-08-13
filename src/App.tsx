import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { LoginPage } from './auth/LoginPage'
import { SetPasswordPage } from './auth/SetPasswordPage'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ItemsListPage } from './features/items/ItemsListPage'
import { NewItemPage } from './features/items/NewItemPage'
import { ItemSearchPage } from './features/items/ItemSearchPage'
import { PriceManagerPage } from './features/items/PriceManagerPage'
import { StockLevelsPage } from './features/stock/StockLevelsPage'
import { StockMovementsPage } from './features/stock/StockMovementsPage'
import { SuppliersListPage } from './features/suppliers/SuppliersListPage'
import { PurchaseOrdersListPage } from './features/purchase-orders/PurchaseOrdersListPage'
import { PurchaseOrderForm } from './features/purchase-orders/PurchaseOrderForm'
import { PurchaseOrderDetailPage } from './features/purchase-orders/PurchaseOrderDetailPage'
import { CustomersListPage } from './features/customers/CustomersListPage'
import { SalesReceiptsListPage } from './features/sales/SalesReceiptsListPage'
import { NewSalesReceiptPage } from './features/sales/NewSalesReceiptPage'
import { SalesReceiptDetailPage } from './features/sales/SalesReceiptDetailPage'
import { InvoicesListPage } from './features/invoices/InvoicesListPage'
import { NewInvoicePage } from './features/invoices/NewInvoicePage'
import { InvoiceDetailPage } from './features/invoices/InvoiceDetailPage'
import { SupplierBillsListPage } from './features/supplier-bills/SupplierBillsListPage'
import { NewSupplierBillPage } from './features/supplier-bills/NewSupplierBillPage'
import { SupplierBillDetailPage } from './features/supplier-bills/SupplierBillDetailPage'
import { CompanyInfoPage } from './features/settings/CompanyInfoPage'
import { LocationsSettingsPage } from './features/settings/LocationsSettingsPage'
import { PriceListsPage } from './features/settings/PriceListsPage'
import { CategoriesPage } from './features/settings/CategoriesPage'
import { BrandsPage } from './features/settings/BrandsPage'
import { UnitsPage } from './features/settings/UnitsPage'
import { AreasPage } from './features/settings/AreasPage'
import { CapitalMatrixPage } from './features/accounts/CapitalMatrixPage'
import { AccountLedgerPage } from './features/accounts/AccountLedgerPage'
import { FiscalDaybookPage } from './features/accounts/FiscalDaybookPage'
import { NewJournalEntryPage } from './features/accounts/NewJournalEntryPage'
import { ReceivePaymentPage } from './features/accounts/ReceivePaymentPage'
import { ViewPaymentsPage } from './features/accounts/ViewPaymentsPage'
import { RecordDepositPage } from './features/accounts/RecordDepositPage'
import { ViewDepositsPage } from './features/accounts/ViewDepositsPage'
import { PayBillsPage } from './features/accounts/PayBillsPage'
import { ViewPaidBillsPage } from './features/accounts/ViewPaidBillsPage'
import { BankingPage } from './features/accounts/BankingPage'
import { AllTransactionsPage } from './features/transactions/AllTransactionsPage'
import { InventoryTransfersPage } from './features/inventory/InventoryTransfersPage'
import { InventoryAdjustmentsPage } from './features/inventory/InventoryAdjustmentsPage'
import { ExpensesListPage } from './features/expenses/ExpensesListPage'
import { NewExpensePage } from './features/expenses/NewExpensePage'
import { QuotationsListPage } from './features/quotations/QuotationsListPage'
import { NewQuotationPage } from './features/quotations/NewQuotationPage'
import { QuotationDetailPage } from './features/quotations/QuotationDetailPage'
import { CreditMemosListPage } from './features/credit-memos/CreditMemosListPage'
import { NewCreditMemoPage } from './features/credit-memos/NewCreditMemoPage'
import { CreditMemoDetailPage } from './features/credit-memos/CreditMemoDetailPage'
import { RefundsListPage } from './features/refunds/RefundsListPage'
import { NewRefundPage } from './features/refunds/NewRefundPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />

        <Route path="/items" element={<Navigate to="/items/list" replace />} />
        <Route path="/items/list" element={<ItemsListPage />} />
        <Route path="/items/new" element={<NewItemPage />} />
        <Route path="/items/search" element={<ItemSearchPage />} />
        <Route path="/items/price-manager" element={<PriceManagerPage />} />

        <Route path="/stock" element={<StockLevelsPage />} />
        <Route path="/stock/movements" element={<StockMovementsPage />} />
        <Route path="/suppliers" element={<SuppliersListPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersListPage />} />
        <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/customers" element={<CustomersListPage />} />
        <Route path="/sales" element={<SalesReceiptsListPage />} />
        <Route path="/sales/new" element={<NewSalesReceiptPage />} />
        <Route path="/sales/:id" element={<SalesReceiptDetailPage />} />
        <Route path="/invoices" element={<InvoicesListPage />} />
        <Route path="/invoices/new" element={<NewInvoicePage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/supplier-bills" element={<SupplierBillsListPage />} />
        <Route path="/supplier-bills/new" element={<NewSupplierBillPage />} />
        <Route path="/supplier-bills/:id" element={<SupplierBillDetailPage />} />

        <Route path="/transactions" element={<AllTransactionsPage />} />
        <Route path="/inventory-transfers" element={<InventoryTransfersPage />} />
        <Route path="/inventory-adjustments" element={<InventoryAdjustmentsPage />} />
        <Route path="/expenses" element={<ExpensesListPage />} />
        <Route path="/expenses/new" element={<NewExpensePage />} />
        <Route path="/quotations" element={<QuotationsListPage />} />
        <Route path="/quotations/new" element={<NewQuotationPage />} />
        <Route path="/quotations/:id" element={<QuotationDetailPage />} />
        <Route path="/credit-memos" element={<CreditMemosListPage />} />
        <Route path="/credit-memos/new" element={<NewCreditMemoPage />} />
        <Route path="/credit-memos/:id" element={<CreditMemoDetailPage />} />
        <Route path="/refunds" element={<RefundsListPage />} />
        <Route path="/refunds/new" element={<NewRefundPage />} />

        <Route path="/account" element={<Navigate to="/account/capital-matrix" replace />} />
        <Route path="/account/capital-matrix" element={<CapitalMatrixPage />} />
        <Route path="/account/capital-matrix/:id" element={<AccountLedgerPage />} />
        <Route path="/account/fiscal-daybook" element={<FiscalDaybookPage />} />
        <Route path="/account/fiscal-daybook/new" element={<NewJournalEntryPage />} />
        <Route path="/account/receive-payment" element={<ReceivePaymentPage />} />
        <Route path="/account/view-payments" element={<ViewPaymentsPage />} />
        <Route path="/account/record-deposit" element={<RecordDepositPage />} />
        <Route path="/account/view-deposits" element={<ViewDepositsPage />} />
        <Route path="/account/pay-bills" element={<PayBillsPage />} />
        <Route path="/account/view-paid-bills" element={<ViewPaidBillsPage />} />
        <Route path="/account/banking" element={<BankingPage />} />

        <Route path="/settings" element={<Navigate to="/settings/company-info" replace />} />
        <Route path="/settings/company-info" element={<CompanyInfoPage />} />
        <Route
          path="/settings/stores"
          element={
            <LocationsSettingsPage type="store" title="Stores" subtitle="Retail locations" singular="Store" />
          }
        />
        <Route
          path="/settings/warehouses"
          element={
            <LocationsSettingsPage
              type="warehouse"
              title="Warehouses"
              subtitle="Storage locations"
              singular="Warehouse"
            />
          }
        />
        <Route path="/settings/price-lists" element={<PriceListsPage />} />
        <Route path="/settings/categories" element={<CategoriesPage />} />
        <Route path="/settings/brands" element={<BrandsPage />} />
        <Route path="/settings/units" element={<UnitsPage />} />
        <Route path="/settings/areas" element={<AreasPage />} />
      </Route>
    </Routes>
  )
}

export default App
