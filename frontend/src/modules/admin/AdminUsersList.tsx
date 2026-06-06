import type { AdminUser } from "../../types/domain";

export function AdminUsersList({ users }: { users: AdminUser[] }) {
  return (
    <div className="admin-list">
      {users.map((item) => (
        <article className="admin-row" key={item.id}>
          <div><strong>{item.profile?.fullName || item.email}</strong><span>{item.email}</span></div>
          <div><span>Plan</span><strong>{item.plan}</strong></div>
          <div><span>Base resumes</span><strong>{item._count?.resumeBases || 0}</strong></div>
          <div><span>Searches</span><strong>{item.usage?.SEARCH_RUN || 0}</strong></div>
          <div><span>Vacancies</span><strong>{item.usage?.VACANCY_COLLECTED || 0}</strong></div>
          <div><span>Tokens</span><strong>{(item.tokensUsed || 0).toLocaleString()}</strong></div>
        </article>
      ))}
    </div>
  );
}
