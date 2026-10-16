const form = document.getElementById("customer-payment-form");
const country = document.getElementById("country");
const phoneNumber = document.getElementById("phone-number");
const amount = document.getElementById("amount");
const currencyLabel = document.getElementById("currency-label");
const submitButton = document.getElementById("prepare-button");
const notice = document.getElementById("pay-entry-notice");
const countryDirectory = [
  { code: "BEN", name: "Benin", flag: "🇧🇯" },
  { code: "CMR", name: "Cameroon", flag: "🇨🇲" },
  { code: "CIV", name: "Côte d’Ivoire", flag: "🇨🇮" },
  { code: "COD", name: "Democratic Republic of the Congo", flag: "🇨🇩" },
  { code: "GAB", name: "Gabon", flag: "🇬🇦" },
  { code: "KEN", name: "Kenya", flag: "🇰🇪" },
  { code: "MOZ", name: "Mozambique", flag: "🇲🇿" },
  { code: "COG", name: "Republic of the Congo", flag: "🇨🇬" },
  { code: "RWA", name: "Rwanda", flag: "🇷🇼" },
  { code: "SEN", name: "Senegal", flag: "🇸🇳" },
  { code: "SLE", name: "Sierra Leone", flag: "🇸🇱" },
  { code: "UGA", name: "Uganda", flag: "🇺🇬" },
  { code: "ZMB", name: "Zambia", flag: "🇿🇲" }
];
let paymentOptions = [];

function showNotice(message, type = "") {
  notice.hidden = false;
  notice.className = `notice${type ? ` ${type}` : ""}`;
  notice.textContent = message;
}

function updateCountryCurrency() {
  const selected = paymentOptions.find(item => item.country === country.value);
  currencyLabel.textContent = selected ? selected.currency : "Select a country";
  if (selected) {
    amount.step = selected.decimals === 0 ? "1" : `0.${"0".repeat(Math.max(0, selected.decimals - 1))}1`;
    amount.min = selected.minTransactionLimit || (selected.decimals === 0 ? "1" : "0.01");
    amount.max = Number.isFinite(selected.maxTransactionLimit) ? selected.maxTransactionLimit : "";
    phoneNumber.placeholder = `Country code +${selected.prefix} will be added if needed`;
  }
  submitButton.disabled = !selected;
}

function renderCountryDirectory() {
  country.replaceChildren(new Option("Select your country", ""));
  for (const item of countryDirectory) {
    const hasOperationalDeposit = paymentOptions.some(option => option.country === item.code && option.prefix);
    const option = new Option(`${item.flag}   ${item.name}`, item.code);
    option.disabled = !hasOperationalDeposit;
    country.add(option);
  }
  country.disabled = false;
  country.addEventListener("change", updateCountryCurrency);
}

async function loadCountries() {
  try {
    const response = await fetch("/api/payment-options", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.countries)) {
      renderCountryDirectory();
      throw new Error(data.error || "Payment countries are temporarily unavailable.");
    }
    paymentOptions = data.countries;
    renderCountryDirectory();
    if (!paymentOptions.length) showNotice("Mobile money payments are temporarily unavailable. Please contact our team.", "error");
  } catch (error) {
    if (!country.options.length || country.options.length === 1) renderCountryDirectory();
    showNotice(error.message || "Could not load payment options. Please try again later.", "error");
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Starting payment…";
  showNotice("Checking your country, phone number, and amount.");
  try {
    const selected = paymentOptions.find(item => item.country === country.value);
    const response = await fetch("/api/customer-payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: country.value,
        currency: selected?.currency,
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
