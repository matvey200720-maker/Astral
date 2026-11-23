import SettingsPage from "./SettingsPage.jsx";

export default function SettingsHub({
  account,
  onBack,
  onOpenProfile,
  game,
  games,
  onSelectGame,
  onChooseGame,
  onReset,
  resetItem,
  restoreMods,
  language,
  onLanguage,
  mods,
  motionChoice,
  onMotionChoice,
  motionEnabled,
}) {
  return (
    <div className="settings-hub">
      <SettingsPage
        account={account}
        onBack={onBack}
        onOpenProfile={onOpenProfile}
        game={game}
        games={games}
        onSelectGame={onSelectGame}
        onChooseGame={onChooseGame}
        onReset={onReset}
        resetItem={resetItem}
        restoreMods={restoreMods}
        language={language}
        onLanguage={onLanguage}
        mods={mods}
        motionChoice={motionChoice}
        onMotionChoice={onMotionChoice}
        motionEnabled={motionEnabled}
      />
    </div>
  );
}
