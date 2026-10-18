import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
// Auth pages load eagerly (entry points). Everything behind login is lazy
// loaded so the initial bundle stays small and fast.
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const Orders = lazy(() => import("./pages/Orders"));
const Alerts = lazy(() => import("./pages/Alerts"));
const EmiCalculator = lazy(() => import("./pages/EmiCalculator"));
const MarketDashboard = lazy(() => import("./pages/MarketDashboard"));
const PortfolioAnalysis = lazy(() => import("./pages/PortfolioAnalysis"));
const PaperTrading = lazy(() => import("./pages/PaperTrading"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
function Loader() {
    return (
        <div className="min-h-screen app-bg flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
    );
}
function App() {
    return (
        <Suspense fallback={<Loader />}>
            <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/home" element={<Home />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/emi" element={<EmiCalculator />} />
                <Route path="/market" element={<MarketDashboard />} />
                <Route path="/analysis" element={<PortfolioAnalysis />} />
                <Route path="/paper" element={<PaperTrading />} />
                <Route path="/watchlist" element={<Watchlist />} />
            </Routes>
        </Suspense>
    );
}
export default App;
