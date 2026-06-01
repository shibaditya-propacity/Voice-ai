export function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="grid gap-6 max-w-2xl">
        <div className="bg-card border rounded-xl p-6">
          <h2 className="font-semibold mb-4">AI Consultant</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p><span className="font-medium text-foreground">Name:</span> Raj Mehta</p>
            <p><span className="font-medium text-foreground">Experience:</span> 15 years in Indian Real Estate</p>
            <p><span className="font-medium text-foreground">Specialization:</span> Apartments, Villas, Commercial, Investment</p>
            <p><span className="font-medium text-foreground">Languages:</span> English, Hindi, Marathi</p>
            <p><span className="font-medium text-foreground">AI Model:</span> Claude 3.5 Sonnet via Amazon Bedrock</p>
            <p><span className="font-medium text-foreground">Voice:</span> ElevenLabs Multilingual v2</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6">
          <h2 className="font-semibold mb-4">Lead Scoring</h2>
          <div className="space-y-2 text-sm">
            {[
              ['Budget Provided', 20],
              ['Location Provided', 20],
              ['Property Type', 20],
              ['Timeline Provided', 20],
              ['Site Visit Booked', 20],
            ].map(([label, score]) => (
              <div key={label as string} className="flex justify-between items-center">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">+{score} points</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Maximum Score</span>
              <span>100 points</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
