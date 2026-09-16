import { initializeFoodSwipeAnalytics } from "@/lib/analytics";

try {
  initializeFoodSwipeAnalytics();
} catch {
  // Client instrumentation must never prevent FoodSwipe from hydrating.
}
