import { SectionHead } from "../../components/ui";
import type { AdminUser } from "../../types/domain";
import { AdminUsersList } from "./AdminUsersList";

type AdminViewProps = {
  adminUsers: AdminUser[];
  onLoadUsers: () => void;
};

export function AdminView({ adminUsers, onLoadUsers }: AdminViewProps) {
  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Users & Usage" subtitle="Plans, generated resumes, vacancies, searches, token usage." />
        <button className="btn btn-secondary" onClick={onLoadUsers}>Load Users</button>
        <AdminUsersList users={adminUsers} />
      </section>
    </section>
  );
}
