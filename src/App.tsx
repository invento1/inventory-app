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
import { InvoiceBatchPrintPage, InvoicePrintPage, SalesReceiptPrintPage } from './features/printing/PrintPages'
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
import { ResetDataPage } from './features/settings/ResetDataPage'
import { UsersPage } from './features/users/UsersPage'
import { SecurityGroupsPage } from './features/users/SecurityGroupsPage'
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
import { ReportsHomePage } from './features/reports/ReportsHomePage'
import { ProfitLossReport } from './features/reports/ProfitLossReport'
import { BalanceSheetReport } from './features/reports/BalanceSheetReport'
import { TrialBalanceReport } from './features/reports/TrialBalanceReport'
import { JournalReport } from './features/reports/JournalReport'
import { GeneralLedgerReport } from './features/reports/GeneralLedgerReport'
import { AccountStatementReport } from './features/reports/AccountStatementReport'
import { CustomerBalancesReport } from './features/reports/CustomerBalancesReport'
import { SupplierBalancesReport } from './features/reports/SupplierBalancesReport'
import { PartyStatementReport } from './features/reports/PartyStatementReport'
import { PaymentCollectionReport } from './features/reports/PaymentCollectionReport'
import { QuantityOnHandReport } from './features/reports/QuantityOnHandReport'
import { InventoryValuationReport } from './features/reports/InventoryValuationReport'
import { InventoryMovementReport } from './features/reports/InventoryMovementReport'
import { StockBySupplierReport } from './features/reports/StockBySupplierReport'
import { PhysicalInventoryWorksheet } from './features/reports/PhysicalInventoryWorksheet'
import { SalesByCategoryReport, SalesByCustomerReport, SalesByItemReport } from './features/reports/SalesSummaryReports'
import {
  CustomerItemSalesReport,
  InvoiceItemsSummaryReport,
  InvoicesSummaryReport,
} from './features/reports/SalesDocumentReports'
import {
  IncomeByCustomerReport,
  PurchasesBySupplierReport,
  TransactionsSummaryReport,
} from './features/reports/CompanyReports'
import { AllTransactionsPage } from './features/transactions/AllTransactionsPage'
import { InventoryTransfersPage } from './features/inventory/InventoryTransfersPage'
import { InventoryAdjustmentsListPage } from './features/inventory/InventoryAdjustmentsListPage'
import { NewInventoryAdjustmentPage } from './features/inventory/NewInventoryAdjustmentPage'
import { InventoryAdjustmentDetailPage } from './features/inventory/InventoryAdjustmentDetailPage'
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
        <Route path="/sales/:id/print" element={<SalesReceiptPrintPage />} />
        <Route path="/invoices" element={<InvoicesListPage />} />
        <Route path="/invoices/new" element={<NewInvoicePage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/invoices/:id/print" element={<InvoicePrintPage />} />
        <Route path="/supplier-bills" element={<SupplierBillsListPage />} />
        <Route path="/supplier-bills/new" element={<NewSupplierBillPage />} />
        <Route path="/supplier-bills/:id" element={<SupplierBillDetailPage />} />

        <Route path="/transactions" element={<AllTransactionsPage />} />
        <Route path="/inventory-transfers" element={<InventoryTransfersPage />} />
        <Route path="/inventory-adjustments" element={<InventoryAdjustmentsListPage />} />
        <Route path="/inventory-adjustments/new" element={<NewInventoryAdjustmentPage />} />
        <Route path="/inventory-adjustments/:id" element={<InventoryAdjustmentDetailPage />} />
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
        <Route path="/account/profit-loss" element={<Navigate to="/reports/profit-loss" replace />} />

        <Route path="/reports" element={<ReportsHomePage />} />
        <Route path="/reports/profit-loss" element={<ProfitLossReport />} />
        <Route path="/reports/balance-sheet" element={<BalanceSheetReport />} />
        <Route path="/reports/trial-balance" element={<TrialBalanceReport />} />
        <Route path="/reports/journal" element={<JournalReport />} />
        <Route path="/reports/general-ledger" element={<GeneralLedgerReport />} />
        <Route path="/reports/account-statement" element={<AccountStatementReport />} />
        <Route path="/reports/customer-balances" element={<CustomerBalancesReport />} />
        <Route path="/reports/customer-statement" element={<PartyStatementReport key="customer" kind="customer" />} />
        <Route path="/reports/payment-collection" element={<PaymentCollectionReport />} />
        <Route path="/reports/supplier-balances" element={<SupplierBalancesReport />} />
        <Route path="/reports/supplier-statement" element={<PartyStatementReport key="supplier" kind="supplier" />} />
        <Route path="/reports/quantity-on-hand" element={<QuantityOnHandReport />} />
        <Route path="/reports/inventory-valuation" element={<InventoryValuationReport />} />
        <Route path="/reports/inventory-movement" element={<InventoryMovementReport />} />
        <Route path="/reports/stock-by-supplier" element={<StockBySupplierReport />} />
        <Route path="/reports/physical-inventory-worksheet" element={<PhysicalInventoryWorksheet />} />
        <Route path="/reports/income-by-customer" element={<IncomeByCustomerReport />} />
        <Route path="/reports/transactions-summary" element={<TransactionsSummaryReport />} />
        <Route path="/reports/purchases-by-supplier" element={<PurchasesBySupplierReport />} />
        <Route path="/reports/sales-by-item" element={<SalesByItemReport />} />
        <Route path="/reports/sales-by-category" element={<SalesByCategoryReport />} />
        <Route path="/reports/sales-by-customer" element={<SalesByCustomerReport />} />
        <Route path="/reports/invoices-summary" element={<InvoicesSummaryReport />} />
        <Route path="/reports/invoice-items-summary" element={<InvoiceItemsSummaryReport />} />
        <Route path="/reports/customer-item-sales" element={<CustomerItemSalesReport />} />
        <Route path="/reports/invoice-batch-print" element={<InvoiceBatchPrintPage />} />

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
        <Route path="/settings/users" element={<UsersPage />} />
        <Route path="/settings/security-groups" element={<SecurityGroupsPage />} />
        <Route path="/settings/reset-data" element={<ResetDataPage />} />
      </Route>
    </Routes>
  )
}

export default App
