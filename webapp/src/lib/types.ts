export type Priority = "Low" | "Medium" | "High";
export type Status = "Pending" | "In Progress" | "Completed";

export interface Course {
  id: string;
  name: string;
  code: string;
  color: string;
}

export interface Assignment {
  id: string;
  title: string;
  courseId: string;
  dueDate: string; // ISO date string
  priority: Priority;
  status: Status;
  description?: string;
  points?: number;
}

export interface GeneratedGuide {
  id: string;
  title: string;
  courseId: string;
  assignmentId?: string;
  generatedAt: string; // ISO date string
  status: "Ready" | "Refreshing";
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Stat {
  label: string;
  value: string | number;
  change?: string; // e.g., "+12%"
  trend?: "up" | "down" | "neutral";
}
