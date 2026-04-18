import { Route, Switch } from "wouter";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { AdminOnboardingPanel } from "@/pages/AdminOnboardingPanel";
import { MentorClaimPage } from "@/pages/MentorClaimPage";
import { RevampSpacePage } from "@/pages/RevampSpacePage";

export default function App() {
  return (
    <Switch>
      <Route path="/admin/:token/new" component={AdminOnboardingPanel} />
      <Route path="/mentor/:inviteToken" component={MentorClaimPage} />
      <Route path="/revamp-space" component={RevampSpacePage} />
      <Route component={OnboardingFlow} />
    </Switch>
  );
}
