import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { LanguageProvider } from './context/LanguageContext';
import TabBar from './components/TabBar';
import Home from './pages/Home';
import MyOrders from './pages/MyOrders';
import Profile from './pages/Profile';
import PhotoSelect from './pages/PhotoSelect';
import Editor from './pages/Editor';
import Checkout from './pages/Checkout';
import OrderSuccess from './pages/OrderSuccess';
import OrderDetail from './pages/OrderDetail';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import AdminPromos from './pages/AdminPromos';
import DeleteAccountRequest from './pages/DeleteAccountRequest';
import SplashScreen from './components/common/SplashScreen';

function Layout() {
  const location = useLocation();

  const hideTabs =
    location.pathname.startsWith("/create") ||
    location.pathname.startsWith("/admin") ||
    location.pathname === "/checkout" ||
    location.pathname === "/order-success" ||
    location.pathname === "/privacy" ||
    location.pathname === "/terms" ||
    location.pathname === "/faq" ||
    location.pathname === "/contact" ||
    location.pathname === "/delete-account";

  return (
    <>
      <Routes>
        {/* Tab-based Main Area */}
        <Route path="/" element={<Home />} />
        <Route path="/orders" element={<MyOrders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/profile" element={<Profile />} />

        {/* Support & Legal (No Auth) */}
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/delete-account" element={<DeleteAccountRequest />} />

        {/* Creation Flow (Outside Tabs) */}
        <Route path="/create/select" element={<PhotoSelect />} />
        <Route path="/create/editor" element={<Editor />} />
        <Route path="/create/checkout" element={<Checkout />} />
        <Route path="/order-success" element={<OrderSuccess />} />

        {/* Admin (Outside Tabs) */}
        <Route path="/admin/promos" element={<AdminPromos />} />
      </Routes>

      {!hideTabs && <TabBar />}
    </>
  );
}

function App() {
  const [showSplash, setShowSplash] = React.useState(true);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <LanguageProvider>
      <Router>
        <Layout />
      </Router>
    </LanguageProvider>
  );
}

export default App;

