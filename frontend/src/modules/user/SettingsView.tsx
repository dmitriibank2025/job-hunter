import { Field, SectionHead } from "../../components/ui";

type LinkedInAccountDraft = {
  email: string;
  passwordSecretRef: string;
  storageStatePath: string;
};

type SettingsViewProps = {
  linkedinAccount: LinkedInAccountDraft;
  setLinkedinAccount: (account: LinkedInAccountDraft) => void;
  onSaveLinkedIn: () => void;
};

export function SettingsView({ linkedinAccount, setLinkedinAccount, onSaveLinkedIn }: SettingsViewProps) {
  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Centralized Search Accounts" subtitle="LinkedIn provider credentials are centralized. User LinkedIn credentials are optional and should only be used for a dedicated advanced search account." />
        <div className="search-explainer">
          <strong>Email and Telegram tracking</strong>
          <span>Preferred flow: the user connects Gmail with read-only OAuth scopes, then the backend reads application confirmations and recruiter replies to update positive, negative, and no-response statistics.</span>
          <span>If the user does not grant mailbox access, they must mark applications manually with the Applied button and update outcomes honestly when responses arrive.</span>
          <span>Telegram delivery needs a bot token, the user's chat id, and a user-to-chat mapping before personal messages can be sent to the chatbot without leaking another user's data.</span>
        </div>
        <Field label="LinkedIn Email" value={linkedinAccount.email} onChange={(value) => setLinkedinAccount({ ...linkedinAccount, email: value })} />
        <Field label="Password Secret Reference" value={linkedinAccount.passwordSecretRef} onChange={(value) => setLinkedinAccount({ ...linkedinAccount, passwordSecretRef: value })} />
        <Field label="Browser Storage State Path" value={linkedinAccount.storageStatePath} onChange={(value) => setLinkedinAccount({ ...linkedinAccount, storageStatePath: value })} />
        <button className="btn btn-primary" onClick={onSaveLinkedIn}>Save LinkedIn Account</button>
      </section>
    </section>
  );
}
