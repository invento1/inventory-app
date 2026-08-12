import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { LoginPage } from './auth/LoginPage'
import { SetPasswordPage } from './auth/SetPasswordPage'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ItemsListPage } from './features/items/ItemsListPage'
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
        <Route path="/items" element={<ItemsListPage />} />
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
      </Route>
    </Routes>
  )
}

export default App
