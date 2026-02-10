"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account preferences and notifications.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Configure how you receive alerts about your assignments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="flex items-center justify-between">
                <Label htmlFor="email-notifs">Email Notifications</Label>
                {/* Switch would go here, using placeholder for now */}
                <div className="h-6 w-10 bg-muted rounded-full"></div>
             </div>
             <div className="flex items-center justify-between">
                <Label htmlFor="browser-notifs">Browser Notifications</Label>
                <div className="h-6 w-10 bg-muted rounded-full"></div>
             </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy</CardTitle>
            <CardDescription>Control your data sharing preferences.</CardDescription>
          </CardHeader>
          <CardContent>
             <p className="text-sm text-muted-foreground italic">Privacy settings are managed via your University SSO.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}