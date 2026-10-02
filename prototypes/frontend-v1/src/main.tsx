import "@fontsource-variable/antonio"
import "@fontsource-variable/geist-mono"
import "@fontsource-variable/noto-sans-sc"
import "@/styles/globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router"

import { AppLayout, AuthLayout, HomeGate, RequireGuest, RequireMember, RequireAdmin } from "@/app-layout"
import { AboutPage } from "@/pages/about"
import { AccountPage } from "@/pages/account"
import { AdminPage } from "@/pages/admin"
import { BrowsePage } from "@/pages/browse"
import { GuestStarChart } from "@/pages/guest-home/star-chart"
import { HeroStudiesPage } from "@/pages/hero-studies"
import { HomePage } from "@/pages/home"
import { InvitesPage } from "@/pages/invites"
import { LibraryPage } from "@/pages/library"
import { LoginPage } from "@/pages/login"
import { NotFoundPage } from "@/pages/not-found"
import { PlaylistPage, PublicPlaylistsPage } from "@/pages/playlist"
import { RecoverPage } from "@/pages/recover"
import { RegisterPage } from "@/pages/register"
import { ResetPage } from "@/pages/reset"
import { TitlePage } from "@/pages/title"
import { WatchPage } from "@/pages/watch"

const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        element: <RequireGuest />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/recover", element: <RecoverPage /> },
          { path: "/reset/:token", element: <ResetPage /> },
        ],
      },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      // Public: members see their home, guests the landing page. Requirement 5.1/1 needs updating if this stays.
      { path: "/", element: <HomeGate member={<HomePage />} guest={<GuestStarChart />} /> },
      { path: "/hero-studies", element: <HeroStudiesPage /> },
      { path: "/about", element: <AboutPage /> },
      {
        element: <RequireMember />,
        children: [
          { path: "/series", element: <BrowsePage kind="series" /> },
          { path: "/movies", element: <BrowsePage kind="movie" /> },
          { path: "/title/:slug", element: <TitlePage /> },
          { path: "/watch/:unitId", element: <WatchPage /> },
          { path: "/library", element: <LibraryPage /> },
          { path: "/playlists", element: <PublicPlaylistsPage /> },
          { path: "/playlists/:id", element: <PlaylistPage /> },
          { path: "/invites", element: <InvitesPage /> },
          { path: "/account", element: <AccountPage /> },
          { element: <RequireAdmin />, children: [{ path: "/admin", element: <AdminPage /> }] },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
