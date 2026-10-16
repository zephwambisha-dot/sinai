const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";
const stateBox = document.getElementById("checkout-state");
const details = document.getElementById("quote-details");
const button = document.getElementById("pay-button");
let canPay = false;

function setNotice(message, kind = "") {
  stateBox.textContent = message;
  stateBox.className = `notice ${kind}`.trim();
}

function showQuote(quote) {
  details.hidden = false;
  document.getElementById("quote-reason").textContent = quote.reason;
  document.getElementById("quote-amount").textContent = `${quote.amount} ${quote.currency}`;
  const status = quote.status === "PAID" ? "Paid" : quote.status === "PROCESSING" || quote.status === "INITIATING" ? "Payment in progress" : quote.canPay ? "Awaiting payment" : "Link expired";
  document.getElementById("quote-status").textContent = status;
  canPay = Boolean(quote.canPay);
  button.disabled = !canPay;
  if (quote.status === "PAID") setNotice("Payment received. SIN AI will confirm your project details shortly.", "success");
  else if (quote.status === "PROCESSING" || quote.status === "INITIATING") setNotice("Payment started. Approve it on your phone, then refresh this page to check the result.");
  else if (!quote.canPay) setNotice("This payment link has expired. Contact SIN AI for a current link.", "error");
  else setNotice("The amount is fixed to the quote approved with SIN AI.");
}

async function loadQuote() {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    setNotice("This payment link is invalid. Please ask SIN AI for a new one.", "error");
    return;
  }
  try {
    const response = await fetch(`/api/payment-link?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Payment details are unavailable.");
    showQuote(data.quote);
  } catch (error) {
    setNotice(error.message || "Payment details are temporarily unavailable. Refresh to try again.", "error");
  }
}

button.addEventListener("click", async () => {
  if (!canPay) return;
  button.disabled = true;
  button.textContent = "Opening secure checkout…";
  setNotice("Connecting securely to PawaPay…");
  try {
    const response = await fetch("/api/payment-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start the payment.");
    window.location.assign(data.redirectUrl);
  } catch (error) {
    setNotice(error.message || "Could not start the payment. Refresh and try again.", "error");
    button.textContent = "Try again";
    await loadQuote();
  }
});

loadQuote();
