import { orgStore } from './orgStore';

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedName: string;
  assignedEmail: string;
  assignedPhone?: string;
  assignedRole?: string;
  assignedDept?: string;
  status: 'pending' | 'in-progress' | 'done' | 'overdue';
  priority: 'low' | 'medium' | 'high';
  deadline: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  followUpSentAt: string | null;
}

const TASKS_CHANGED = 'edgeos:tasks-changed';

function notifyTasksChanged() {
  try { window.dispatchEvent(new CustomEvent(TASKS_CHANGED)); } catch {}
}

export const taskStore = {
  onChanged(cb: () => void) {
    window.addEventListener(TASKS_CHANGED, cb);
    return () => window.removeEventListener(TASKS_CHANGED, cb);
  },

  getAll(): Task[] {
    const list = orgStore.getSectionAsList('tasks') as Task[];
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getByEmployee(employeeId: string): Task[] {
    return this.getAll().filter(t => t.assignedTo === employeeId);
  },

  getActive(): Task[] {
    return this.getAll().filter(t => t.status !== 'done');
  },

  getOverdue(): Task[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.getAll().filter(t =>
      t.status !== 'done' && t.deadline && t.deadline < today
    );
  },

  getDueToday(): Task[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.getAll().filter(t =>
      t.status !== 'done' && t.deadline === today
    );
  },

  getDueTomorrow(): Task[] {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ts = tomorrow.toISOString().slice(0, 10);
    return this.getAll().filter(t =>
      t.status !== 'done' && t.deadline === ts
    );
  },

  async create(data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const now = new Date().toISOString();
    const task = await orgStore.addItem('tasks', {
      ...data,
      followUpSentAt: data.followUpSentAt ?? null,
      createdAt: now,
      updatedAt: now,
    }) as Task;
    notifyTasksChanged();
    return task;
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    await orgStore.updateItem('tasks', id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    notifyTasksChanged();
  },

  async markOverdue(id: string): Promise<void> {
    await this.update(id, { status: 'overdue' });
  },

  async markFollowUpSent(id: string): Promise<void> {
    await this.update(id, { followUpSentAt: new Date().toISOString() });
  },

  remove(id: string): void {
    orgStore.removeItem('tasks', id);
    notifyTasksChanged();
  },
};
