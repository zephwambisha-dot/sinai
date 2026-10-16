const form = document.getElementById("link-form");
const result = document.getElementById("admin-result");
const button = document.getElementById("create-button");

form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Checking PawaPay options…";
  result.hidden = false;
  result.className = "notice";
  result.textContent = "Creating a fixed quote link…";
  try {
    const response = await fetch("/api/payment-links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${document.getElementById("admin-token").value}`
      },
      body: JSON.stringify({
        reference: document.getElementById("reference").value,
        reason: document.getElementById("reason").value,
        amount: document.getElementById("amount").value,
        currency: document.getElementById("currency").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create a payment link.");
    result.className = "notice success";
    result.replaceChildren();
    const label = document.createElement("p");
    label.textContent = `Created: ${data.amount} ${data.currency}. Expires ${new Date(data.expiresAt).toLocaleDateString()}.`;
    const link = document.createElement("a");
    link.href = data.link;
    link.textContent = data.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "generated-link";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-link";
    copy.textContent = "Copy link";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(data.link);
      copy.textContent = "Copied";
    });
    result.append(label, link, copy);
    form.reset();
    document.getElementById("currency").value = "UGX";
  } catch (error) {
    result.className = "notice error";
    result.textContent = error.message || "Could not create the payment link.";
  } finally {
    button.disabled = false;
    button.textContent = "Create payment link";
  }
});
