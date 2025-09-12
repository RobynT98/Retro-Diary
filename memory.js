// Minnesläge – toggle och spara state
document.addEventListener("DOMContentLoaded", () => {
  const memBtn = document.getElementById("memoryBtn");
  if (!memBtn) return;

  // Läs sparat läge
  if (localStorage.getItem("memoryMode") === "on") {
    document.body.classList.add("memory-mode");
  }

  memBtn.addEventListener("click", () => {
    document.body.classList.toggle("memory-mode");
    const isOn = document.body.classList.contains("memory-mode");
    localStorage.setItem("memoryMode", isOn ? "on" : "off");
  });
});
