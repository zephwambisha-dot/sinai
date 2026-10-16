const form = document.getElementById("customer-payment-form");
const country = document.getElementById("country");
const phoneNumber = document.getElementById("phone-number");
const amount = document.getElementById("amount");
const currencyLabel = document.getElementById("currency-label");
const submitButton = document.getElementById("prepare-button");
const notice = document.getElementById("pay-entry-notice");
let paymentOptions = [];

function showNotice(message, type = "") {
  notice.hidden = false;
  notice.className = `notice${type ? ` ${type}` : ""}`;
  notice.textContent = message;
}

function updateCountryCurrency() {
  const [countryCode, currency] = country.value.split(":");
  const selected = paymentOptions.find(item => item.country === countryCode && item.currency === currency);
  currencyLabel.textContent = selected ? `Currency: ${selected.currency}` : "";
  if (selected) {
    amount.step = selected.decimals === 0 ? "1" : `0.${"0".repeat(Math.max(0, selected.decimals - 1))}1`;
    amount.min = selected.minTransactionLimit || (selected.decimals === 0 ? "1" : "0.01");
    amount.max = Number.isFinite(selected.maxTransactionLimit) ? selected.maxTransactionLimit : "";
    phoneNumber.placeholder = `Country code +${selected.prefix} will be added if needed`;
  }
}

async function loadCountries() {
  try {
    const response = await fetch("/api/payment-options", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.countries) || !data.countries.length) {
      throw new Error(data.error || "No payment countries are available right now.");
    }
    paymentOptions = data.countries;
    country.replaceChildren(new Option("Choose your country", ""));
    for (const option of paymentOptions) {
      country.add(new Option(`${option.name} (${option.currency})`, `${option.country}:${option.currency}`));
    }
    country.disabled = false;
    country.addEventListener("change", updateCountryCurrency);
    submitButton.disabled = false;
  } catch (error) {
    country.replaceChildren(new Option("Unavailable", ""));
    showNotice(error.message || "Could not load payment countries. Please try again later.", "error");
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Starting payment…";
  showNotice("Checking your country, phone number, and amount.");
  try {
    const [countryCode, currency] = country.value.split(":");
    const response = await fetch("/api/customer-payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: countryCode,
        currency,
        phoneNumber: phoneNumber.value,
        amount: amount.value,
        website: document.getElementById("website").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start this payment.");
    window.location.assign(data.paymentUrl);
  } catch (error) {
    showNotice(error.message || "Could not start this payment. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Pay";
  }
});

loadCountries();
