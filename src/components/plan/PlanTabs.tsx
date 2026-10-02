import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PlanTab = "current" | "upcoming";

interface PlanTabsProps {
  defaultTab: PlanTab;
  /** "This week" panel, server-rendered by Astro and passed as a named slot. */
  current?: ReactNode;
  /** "Next week" panel, server-rendered by Astro and passed as a named slot. */
  upcoming?: ReactNode;
}

/**
 * Switches between the two server-rendered weeks. Both panels are force-mounted and only hidden when
 * inactive, so both weeks are in the server HTML; the active one is readable before hydration.
 */
export default function PlanTabs({ defaultTab, current, upcoming }: PlanTabsProps) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="current">This week</TabsTrigger>
        <TabsTrigger value="upcoming">Next week</TabsTrigger>
      </TabsList>
      <TabsContent value="current" forceMount className="data-[state=inactive]:hidden">
        {current}
      </TabsContent>
      <TabsContent value="upcoming" forceMount className="data-[state=inactive]:hidden">
        {upcoming}
      </TabsContent>
    </Tabs>
  );
}
