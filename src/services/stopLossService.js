import { api } from "./apiClient";

export function getStopLosses() {
    return api("/stoploss");
}

export function createStopLoss({ symbol, name, stopPrice }) {
    return api("/stoploss", {
        method: "POST",
        body: { symbol, name, stopPrice },
    });
}

export function cancelStopLoss(id) {
    return api(`/stoploss/${id}`, { method: "DELETE" });
}
