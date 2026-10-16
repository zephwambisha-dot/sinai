const form = document.getElementById("customer-payment-form");
const country = document.getElementById("country");
const phoneNumber = document.getElementById("phone-number");
const phoneHint = document.getElementById("phone-number-hint");
const amount = document.getElementById("amount");
const submitButton = document.getElementById("prepare-button");
const notice = document.getElementById("pay-entry-notice");

const countryDirectory = [
  { code: "BEN", name: "Benin", flag: "🇧🇯", prefix: "229" },
  { code: "CMR", name: "Cameroon", flag: "🇨🇲", prefix: "237" },
  { code: "CIV", name: "Côte d’Ivoire", flag: "🇨🇮", prefix: "225" },
  { code: "COD", name: "Democratic Republic of the Congo", flag: "🇨🇩", prefix: "243" },
  { code: "GAB", name: "Gabon", flag: "🇬🇦", prefix: "241" },
  { code: "KEN", name: "Kenya", flag: "🇰🇪", prefix: "254" },
  { code: "MOZ", name: "Mozambique", flag: "🇲🇿", prefix: "258" },
  { code: "COG", name: "Republic of the Congo", flag: "🇨🇬", prefix: "242" },
  { code: "RWA", name: "Rwanda", flag: "🇷🇼", prefix: "250" },
  { code: "SEN", name: "Senegal", flag: "🇸🇳", prefix: "221" },
  { code: "SLE", name: "Sierra Leone", flag: "🇸🇱", prefix: "232" },
  { code: "UGA", name: "Uganda", flag: "🇺🇬", prefix: "256" },
  { code: "ZMB", name: "Zambia", flag: "🇿🇲", prefix: "260" }
];

function showNotice(message, type = "") {
  notice.hidden = false;
  notice.className = "notice" + (type ? " " + type : "");
  notice.textContent = message;
}

function updateCountryDetails() {
  const selected = countryDirectory.find(item => item.code === country.value);
  submitButton.disabled = !selected;
  if (selected) {
    phoneNumber.placeholder = "+" + selected.prefix + " then your number";
    phoneHint.textContent = "Enter the full number with country code first. Example: +256 772 123 456. Do not start with 0.";
  } else {
    phoneNumber.placeholder = "+country code, then your number";
  }
}

function renderCountryDirectory() {
  country.replaceChildren(new Option("Select your country", ""));
  for (const item of countryDirectory) {
    country.add(new Option(item.flag + "   " + item.name, item.code));
  }
  country.addEventListener("change", updateCountryDetails);
  updateCountryDetails();
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.innerHTML = "<span>Starting payment…</span><span aria-hidden=\"true\">↗</span>";
  showNotice("Sending a payment request to your phone.");
  try {
    const response = await fetch("/api/customer-payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: country.value,
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
    submitButton.innerHTML = "<span>Pay now</span><span aria-hidden=\"true\">↗</span>";
  }
});

renderCountryDirectory();
