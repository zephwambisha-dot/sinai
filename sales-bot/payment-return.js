const reference = new URLSearchParams(window.location.search).get("reference");
if (reference && /^[A-Za-z0-9-]{1,80}$/.test(reference)) {
  const referenceElement = document.getElementById("payment-reference");
  referenceElement.textContent = `Payment reference: ${reference}`;
  referenceElement.hidden = false;
  const help = document.getElementById("payment-help");
  help.href = `https://wa.me/256765821430?text=${encodeURIComponent(`Hello SIN AI, I have made a payment. My reference is ${reference}. I will send the PawaPay transaction message.`)}`;
}
