import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaCalculator } from "react-icons/fa";
import authService from "../services/authService";
import { getAvatar } from "../services/profileService";
import NavBar from "../components/NavBar";
import TextInput from "../components/TextInput";

const fmt = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

function EmiCalculator() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [avatar, setAvatar] = useState(null);

    const [loanAmount, setLoanAmount] = useState("500000");
    const [annualRatePct, setAnnualRatePct] = useState("9.5");
    const [tenure, setTenure] = useState("5");
    const [unit, setUnit] = useState("years");

    useEffect(() => {
        authService
            .getCurrentUser()
            .then((current) => {
                setUser(current);
                setAvatar(getAvatar(current.$id));
            })
            .catch(() => navigate("/"));
    }, [navigate]);

    const logout = async () => {
        await authService.logout();
        navigate("/");
    };

    const result = useMemo(() => {
        const P = Number(loanAmount);
        const annual = Number(annualRatePct);
        const t = Number(tenure);

        if (
            !Number.isFinite(P) ||
            !Number.isFinite(annual) ||
            !Number.isFinite(t) ||
            P <= 0 ||
            annual < 0 ||
            t <= 0
        ) {
            return null;
        }

        const n = unit === "years" ? Math.round(t * 12) : Math.round(t);
        if (n <= 0) return null;

        const r = annual / 12 / 100;
        const emi =
            r === 0
                ? P / n
                : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        const totalPayable = emi * n;
        const totalInterest = totalPayable - P;

        return { P, n, emi, totalPayable, totalInterest };
    }, [loanAmount, annualRatePct, tenure, unit]);

    const principalPct = result
        ? (result.P / result.totalPayable) * 100
        : 0;

    return (
        <div className="min-h-screen app-bg">
            <NavBar user={{ ...user, avatarUrl: avatar }} onLogout={logout} live />

            <main className="max-w-3xl mx-auto px-6 py-8">
                <button
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 text-muted hover:text-current mb-6"
                >
                    <FaArrowLeft /> Back to dashboard
                </button>

                <div className="surface rounded-3xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-11 w-11 rounded-xl bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
                            <FaCalculator />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">EMI Calculator</h1>
                            <p className="text-muted text-sm">
                                Estimate your monthly loan repayment
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <label className="block">
                            <span className="text-xs text-muted">Loan amount (₹)</span>
                            <div className="mt-1.5">
                                <TextInput
                                    type="number"
                                    min="0"
                                    value={loanAmount}
                                    onChange={(e) => setLoanAmount(e.target.value)}
                                    placeholder="500000"
                                />
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-xs text-muted">
                                Interest rate (% per year)
                            </span>
                            <div className="mt-1.5">
                                <TextInput
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={annualRatePct}
                                    onChange={(e) => setAnnualRatePct(e.target.value)}
                                    placeholder="9.5"
                                />
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-xs text-muted">Tenure</span>
                            <div className="mt-1.5">
                                <TextInput
                                    type="number"
                                    min="0"
                                    value={tenure}
                                    onChange={(e) => setTenure(e.target.value)}
                                    placeholder="5"
                                />
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-xs text-muted">Tenure unit</span>
                            <div className="mt-1.5 flex rounded-xl surface-solid border border-(--border) overflow-hidden">
                                {["years", "months"].map((u) => (
                                    <button
                                        key={u}
                                        type="button"
                                        onClick={() => setUnit(u)}
                                        className={`flex-1 py-3 text-sm capitalize transition ${
                                            unit === u
                                                ? "bg-indigo-600 text-white"
                                                : "text-muted hover:text-current"
                                        }`}
                                    >
                                        {u}
                                    </button>
                                ))}
                            </div>
                        </label>
                    </div>

                    {result ? (
                        <div className="mt-8">
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
                                <p className="text-xs text-muted">Monthly EMI</p>
                                <p className="text-3xl font-extrabold mt-1">
                                    ₹{fmt(result.emi)}
                                </p>
                                <p className="text-xs text-muted mt-1">
                                    over {result.n} month{result.n === 1 ? "" : "s"}
                                </p>
                            </div>

                            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <Stat label="Principal" value={`₹${fmt(result.P)}`} />
                                <Stat
                                    label="Total interest"
                                    value={`₹${fmt(result.totalInterest)}`}
                                />
                                <Stat
                                    label="Total payable"
                                    value={`₹${fmt(result.totalPayable)}`}
                                />
                            </div>

                            <div className="mt-6">
                                <div className="flex justify-between text-xs text-muted mb-1.5">
                                    <span>Principal {principalPct.toFixed(1)}%</span>
                                    <span>
                                        Interest {(100 - principalPct).toFixed(1)}%
                                    </span>
                                </div>
                                <div className="h-3 w-full rounded-full overflow-hidden bg-white/10 flex">
                                    <div
                                        className="bg-indigo-500 h-full"
                                        style={{ width: `${principalPct}%` }}
                                    />
                                    <div
                                        className="bg-fuchsia-500 h-full"
                                        style={{ width: `${100 - principalPct}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-8 text-sm text-red-400">
                            Enter a positive loan amount, a non-negative interest rate,
                            and a positive tenure.
                        </p>
                    )}
                </div>
            </main>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
            <p className="text-xs text-muted">{label}</p>
            <p className="font-bold mt-1 break-words">{value}</p>
        </div>
    );
}

export default EmiCalculator;
