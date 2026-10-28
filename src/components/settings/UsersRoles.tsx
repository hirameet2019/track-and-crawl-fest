"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStaffUser, deleteRole, saveRole, setStaffPassword, updateStaffUser } from "@/app/actions/users";
import { PasswordInput } from "@/components/PasswordInput";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { LOCALE } from "@/config/site";
import { PERMISSIONS, type Permission } from "@/lib/roles";
import type { RoleListRow, UserListRow } from "@/lib/users";

/** The signed-in editor: what they hold decides what they may hand out. */
export interface Me {
  id: string;
  roleId: string | null;
  owner: boolean;
  permissions: Permission[];
}

const covers = (me: Me, perms: readonly Permission[]) => me.owner || perms.every((p) => me.permissions.includes(p));
const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];
const LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label])) as Record<Permission, string>;

// Shared pieces, so the Users and Roles cards line up the same on phones and desktops.
const CARD_HEAD = "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between";
const ROW_BTN = "inline-flex h-8 min-w-[4.25rem] shrink-0 items-center justify-center rounded-lg border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-100";
const PANEL = "rounded-xl border border-zinc-200 p-3 sm:p-5";

/** Settings > Users & roles: staff accounts on top, the roles they can be given below. */
export function UsersRoles({ users, roles, me, domain }: { users: UserListRow[]; roles: RoleListRow[]; me: Me; domain: string }) {
  return (
    <div className="space-y-6">
      <UsersCard users={users} roles={roles} me={me} domain={domain} />
      <RolesCard roles={roles} me={me} />
    </div>
  );
}

/* ----------------------------------------------------------------- users */

function shortLogin(email: string | null, domain: string): string {
  if (!email) return "no login";
  return email.endsWith(`@${domain}`) ? email.slice(0, -domain.length - 1) : email;
}

function when(iso: string | null): string {
  if (!iso) return "never signed in";
  return `last in ${new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function UsersCard({ users, roles, me, domain }: { users: UserListRow[]; roles: RoleListRow[]; me: Me; domain: string }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "off">("active");
  // Roles this editor may give: none with more than they hold.
  const assignable = roles.filter((r) => covers(me, r.permissions));
  const shown = users.filter((u) => (filter === "active" ? u.active : !u.active));
  const offCount = users.filter((u) => !u.active).length;

  return (
    <div className="card space-y-4">
      <div className={CARD_HEAD}>
        <div className="min-w-0 sm:flex-1">
          <h2 className="font-semibold">Users</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Everyone who can sign in to the staff pages. A short username like <code className="rounded bg-zinc-100 px-1">walkin1</code> signs in as walkin1@{domain}. Turning an account off locks it out at once.
          </p>
        </div>
        {!adding && <button type="button" className="btn-primary shrink-0 self-start whitespace-nowrap" onClick={() => { setAdding(true); setEditing(null); }}>Add user</button>}
      </div>

      {adding && <AddUser roles={assignable} domain={domain} onClose={() => setAdding(false)} />}

      <div className="flex flex-wrap gap-1.5">
        {(["active", "off"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-zinc-300 text-zinc-600"}`}
          >
            {f === "active" ? `Active (${users.length - offCount})` : `Turned off (${offCount})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Nobody here.</p>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {shown.map((u) => {
            const self = u.id === me.id;
            const manageable = self || covers(me, u.permissions);
            return (
              <li key={u.id} className="space-y-3 py-3">
                {/* Phone: avatar, details (role badge under them), button. Wider: the badge gets its own column so badges and buttons line up. */}
                <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_5.5rem]">
                  <span aria-hidden className="grid h-8 w-8 place-items-center self-start rounded-full bg-zinc-200 text-xs font-bold text-zinc-700 sm:self-center">
                    {u.full_name.trim().slice(0, 1).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0">
                    <div className="break-words text-sm font-medium">
                      {u.full_name}
                      {self && <span className="ml-1.5 text-[11px] font-normal text-zinc-500">(you)</span>}
                    </div>
                    <div className="truncate font-mono text-xs text-zinc-500" title={u.email ?? undefined}>{shortLogin(u.email, domain)}</div>
                    <div className="text-[11px] text-zinc-500">{when(u.last_sign_in_at)}</div>
                    <div className="mt-1.5 sm:hidden"><RoleBadge user={u} /></div>
                  </div>
                  <div className="hidden min-w-0 sm:block"><RoleBadge user={u} /></div>
                  <div className="flex justify-end">
                    {manageable ? (
                      <button type="button" className={ROW_BTN} aria-expanded={editing === u.id} onClick={() => { setEditing(editing === u.id ? null : u.id); setAdding(false); }}>
                        {editing === u.id ? "Close" : "Edit"}
                      </button>
                    ) : (
                      <span className="text-right text-[11px] leading-tight text-zinc-400" title="This account has permissions you do not have.">System admin only</span>
                    )}
                  </div>
                </div>
                {editing === u.id && <EditUser key={u.id} user={u} roles={roles} assignable={assignable} self={self} onClose={() => setEditing(null)} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RoleBadge({ user }: { user: UserListRow }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold ${user.role_id ? "border-violet-300 bg-violet-50 text-violet-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
      title={user.role_id ? user.role_name : "Old role setting. Pick a role to move it to the new roles."}
    >
      {user.role_name}
    </span>
  );
}

function RoleSelect({ id, roles, value, onChange, disabled, placeholder }: {
  id: string; roles: RoleListRow[]; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <select id={id} className="input h-10" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {!value && <option value="">{placeholder ?? "Pick a role"}</option>}
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}

function AddUser({ roles, domain, onClose }: { roles: RoleListRow[]; domain: string; onClose: () => void }) {
  const router = useRouter();
  const blank = { full_name: "", login: "", password: "", role_id: roles.find((r) => !r.is_owner)?.id ?? roles[0]?.id ?? "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const ready = !!(f.full_name.trim() && f.login.trim() && f.password && f.role_id);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  function save() {
    start(async () => {
      setMsg(null);
      const r = await createStaffUser(f);
      if (!r.ok) return setMsg({ kind: "err", text: r.error });
      const login = f.login.trim().toLowerCase();
      setMsg({ kind: "ok", text: `${f.full_name.trim()} can now sign in as ${login.includes("@") ? login : `${login} (${login}@${domain})`}.${r.linked ? " That login already existed, so its password was replaced." : ""} Share the password with them directly.` });
      setF(blank);
      router.refresh();
    });
  }

  return (
    <div className={`space-y-4 ${PANEL}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-name">Full name</label>
          <input id="new-name" className="input h-10" value={f.full_name} onChange={set("full_name")} autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="new-login">Username or email</label>
          <input id="new-login" className="input h-10 font-mono" value={f.login} onChange={set("login")} placeholder="e.g. walkin3" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="new-password">Password</label>
          <PasswordInput id="new-password" className="input h-10" value={f.password} onChange={set("password")} autoComplete="new-password" minLength={8} />
          <p className="mt-1 text-[11px] text-zinc-500">At least 8 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="new-role">Role</label>
          <RoleSelect id="new-role" roles={roles} value={f.role_id} onChange={(v) => setF((p) => ({ ...p, role_id: v }))} />
        </div>
      </div>
      <SaveBar label="Add user" dirty={ready} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(blank); setMsg(null); onClose(); }} extra={!ready && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>} />
    </div>
  );
}

function EditUser({ user, roles, assignable, self, onClose }: { user: UserListRow; roles: RoleListRow[]; assignable: RoleListRow[]; self: boolean; onClose: () => void }) {
  const router = useRouter();
  const initial = { full_name: user.full_name, role_id: user.role_id ?? "", active: user.active };
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [password, setPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  // The current role stays in the list even when it is not one this editor could give.
  const options = assignable.some((r) => r.id === user.role_id) ? assignable : [...roles.filter((r) => r.id === user.role_id), ...assignable];

  function save() {
    if (initial.active && !f.active && !window.confirm(`Turn off ${user.full_name}? They lose access to the staff pages at once.`)) return;
    start(async () => {
      setMsg(null);
      const r = await updateStaffUser({ id: user.id, ...f });
      setMsg(r.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  function changePassword() {
    start(async () => {
      setPwMsg(null);
      const r = await setStaffPassword(user.id, password);
      setPwMsg(r.ok ? { kind: "ok", text: "Password changed. Share it with them directly." } : { kind: "err", text: r.error });
      if (r.ok) setPassword("");
    });
  }

  return (
    <div className={`space-y-5 ${PANEL}`}>
      <Group title="Account" hint={self ? "You cannot change your own role or turn off your own account." : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`name-${user.id}`}>Full name</label>
            <input id={`name-${user.id}`} className="input h-10" value={f.full_name} onChange={(e) => setF((p) => ({ ...p, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor={`role-${user.id}`}>Role</label>
            <RoleSelect id={`role-${user.id}`} roles={options} value={f.role_id} onChange={(v) => setF((p) => ({ ...p, role_id: v }))} disabled={self} placeholder={`Pick a role (now: ${user.role_name}, old setting)`} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={f.active} disabled={self} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} />
          Can sign in
        </label>
      </Group>
      <SaveBar label="Save account" dirty={dirty && !!f.role_id} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); onClose(); }} />

      <Group title="New password" hint="Sets the password right away. Their current sign-ins stay until they sign out.">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 sm:w-72">
            <PasswordInput aria-label={`New password for ${user.full_name}`} className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} placeholder="At least 8 characters" />
          </div>
          <button type="button" className="btn-secondary h-10 self-start" disabled={pending || password.length < 8} onClick={changePassword}>Set password</button>
        </div>
        {pwMsg && (
          <p role="status" className={`rounded-lg border p-3 text-sm ${pwMsg.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-700"}`}>{pwMsg.text}</p>
        )}
      </Group>
    </div>
  );
}

/* ----------------------------------------------------------------- roles */

function RolesCard({ roles, me }: { roles: RoleListRow[]; me: Me }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="card space-y-4">
      <div className={CARD_HEAD}>
        <div className="min-w-0 sm:flex-1">
          <h2 className="font-semibold">Roles</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            What each role may open and do. Changes apply to everyone on the role the next time a page loads. System admin always has everything.
          </p>
        </div>
        {editing !== "new" && <button type="button" className="btn-primary shrink-0 self-start whitespace-nowrap" onClick={() => setEditing("new")}>Add role</button>}
      </div>

      {editing === "new" && <RoleEditor role={null} me={me} onClose={() => setEditing(null)} />}

      <ul className="divide-y divide-zinc-200">
        {roles.map((r) => {
          const editable = !r.is_owner && covers(me, r.permissions) && (me.owner || me.roleId !== r.id);
          const why = r.is_owner ? "" : me.roleId === r.id && !me.owner ? "Your own role. A System admin can change it." : !covers(me, r.permissions) ? "Has permissions you do not have." : "";
          return (
            <li key={r.id} className="space-y-3 py-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="break-words text-sm font-medium">{r.name}</span>
                    {r.is_owner && <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Owner</span>}
                    <span className="whitespace-nowrap text-[11px] text-zinc-500">{r.users} {r.users === 1 ? "account" : "accounts"}</span>
                  </div>
                  {r.description && <p className="text-xs text-zinc-500">{r.description}</p>}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {r.is_owner ? (
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">Every permission</span>
                    ) : r.permissions.length ? (
                      r.permissions.map((p) => <span key={p} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">{LABEL[p]}</span>)
                    ) : (
                      <span className="text-[11px] text-amber-700">No permissions: accounts on it cannot open anything.</span>
                    )}
                  </div>
                  {!editable && why && <p className="text-[11px] italic text-zinc-400">{why}</p>}
                </div>
                {editable && (
                  <button type="button" className={ROW_BTN} aria-expanded={editing === r.id} onClick={() => setEditing(editing === r.id ? null : r.id)}>
                    {editing === r.id ? "Close" : "Edit"}
                  </button>
                )}
              </div>
              {editing === r.id && <RoleEditor key={r.id} role={r} me={me} onClose={() => setEditing(null)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RoleEditor({ role, me, onClose }: { role: RoleListRow | null; me: Me; onClose: () => void }) {
  const router = useRouter();
  const initial = { name: role?.name ?? "", description: role?.description ?? "", permissions: role?.permissions ?? ([] as Permission[]) };
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const idp = role?.id ?? "new";

  const toggle = (p: Permission, on: boolean) =>
    setF((s) => ({ ...s, permissions: on ? PERMISSIONS.map((x) => x.key).filter((k) => k === p || s.permissions.includes(k)) : s.permissions.filter((k) => k !== p) }));

  function save() {
    if (role && role.users > 0 && role.permissions.some((p) => !f.permissions.includes(p))
      && !window.confirm(`${role.users} ${role.users === 1 ? "account loses" : "accounts lose"} the unticked permissions right away. Save anyway?`)) return;
    start(async () => {
      setMsg(null);
      const r = await saveRole({ id: role?.id ?? null, ...f });
      setMsg(r.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: r.error });
      if (r.ok) {
        router.refresh();
        if (!role) onClose();
      }
    });
  }

  function remove() {
    if (!role || !window.confirm(`Delete the ${role.name} role?`)) return;
    start(async () => {
      const r = await deleteRole(role.id);
      if (!r.ok) return setMsg({ kind: "err", text: r.error });
      onClose();
      router.refresh();
    });
  }

  return (
    <div className={`space-y-5 ${PANEL}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`role-name-${idp}`}>Name</label>
          <input id={`role-name-${idp}`} className="input h-10" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Office" />
        </div>
        <div>
          <label className="label" htmlFor={`role-desc-${idp}`}>Description</label>
          <input id={`role-desc-${idp}`} className="input h-10" value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} placeholder="Who gets this role" />
        </div>
      </div>

      {GROUPS.map((g) => (
        <Group key={g} title={g}>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.filter((p) => p.group === g).map((p) => {
              const allowed = me.owner || me.permissions.includes(p.key);
              return (
                <label key={p.key} className={`flex items-start gap-2.5 rounded-lg border border-zinc-200 p-2.5 text-sm ${allowed ? "cursor-pointer hover:bg-zinc-50" : "opacity-50"}`} title={allowed ? undefined : "You do not have this permission yourself."}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={f.permissions.includes(p.key)} disabled={!allowed} onChange={(e) => toggle(p.key, e.target.checked)} />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-zinc-500">{p.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Group>
      ))}

      <SaveBar
        label={role ? "Save role" : "Add role"}
        dirty={dirty && f.name.trim().length >= 2}
        pending={pending}
        msg={msg}
        onSave={save}
        onDiscard={() => { setF(initial); setMsg(null); onClose(); }}
        extra={!role ? (!dirty && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>) : (
          role.users === 0 && <button type="button" className="btn-secondary text-red-700" disabled={pending} onClick={remove}>Delete role</button>
        )}
      />
      {role && role.users > 0 && <p className="text-[11px] text-zinc-500">To delete this role, move its {role.users === 1 ? "account" : `${role.users} accounts`} to another role first.</p>}
    </div>
  );
}
