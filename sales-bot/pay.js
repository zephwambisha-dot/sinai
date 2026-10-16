const form = document.getElementById("customer-payment-form");
const currency = document.getElementById("currency");
const submitButton = document.getElementById("prepare-button");
const notice = document.getElementById("pay-entry-notice");

function showNotice(message, type = "") {
  notice.hidden = false;
  notice.className = `notice${type ? ` ${type}` : ""}`;
  notice.textContent = message;
}

async function loadCurrencies() {
  try {
    const response = await fetch("/api/payment-options", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.currencies) || !data.currencies.length) {
      throw new Error(data.error || "No payment currencies are available right now.");
    }
    currency.replaceChildren(new Option("Choose currency", ""));
    for (const code of data.currencies) currency.add(new Option(code, code));
    if (data.currencies.includes("UGX")) currency.value = "UGX";
    currency.disabled = false;
    submitButton.disabled = false;
  } catch (error) {
    currency.replaceChildren(new Option("Unavailable", ""));
    showNotice(error.message || "Could not load payment currencies. Please try again later.", "error");
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Preparing secure checkout…";
  showNotice("Checking the amount and currency against the payment options enabled for SIN AI.");
  try {
    const response = await fetch("/api/customer-payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference: document.getElementById("reference").value,
        reason: document.getElementById("reason").value,
        amount: document.getElementById("amount").value,
        currency: currency.value,
        website: document.getElementById("website").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not prepare this payment.");
    showNotice(`Quote saved: ${data.amount} ${data.currency}. Opening the confirmation page…`, "success");
    window.location.assign(data.paymentUrl);
  } catch (error) {
    showNotice(error.message || "Could not prepare this payment. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Review payment";
  }
});

loadCurrencies();
