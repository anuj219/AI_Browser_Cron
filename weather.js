async function getRichWeatherData(location) {
  try {
    // format=j1 gives full JSON data which is perfect for LLM filtering
    const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
    if (!response.ok) throw new Error("Weather service unreachable");
    const data = await response.json();

    // We'll return it as a string so the LLM can "read" the JSON
    return JSON.stringify(data);
  } catch (err) {
    console.error("[Weather API Error]:", err.message);
    return "Could not fetch weather data.";
  }
}

module.exports = { getRichWeatherData };