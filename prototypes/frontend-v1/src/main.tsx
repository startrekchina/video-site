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
import { BackupsPage } from "@/pages/backups"
import { BrowsePage } from "@/pages/browse"
import { ForgotPasswordPage, ResetCompletePage, ResetPasswordPage, VerifyEmailPage, VerifyPendingPage } from "@/pages/email-auth"
import { GuestStarChart } from "@/pages/guest-home/star-chart"
import { HomePage } from "@/pages/home"
import { InvitesPage } from "@/pages/invites"
import { LibraryPage } from "@/pages/library"
import { LoginPage } from "@/pages/login"
import { NotFoundPage } from "@/pages/not-found"
import { PlaylistPage, PublicPlaylistsPage } from "@/pages/playlist"
import { RegisterPage } from "@/pages/register"
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
        ],
      },
      // Email links can be opened while signed in, so these skip RequireGuest.
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/reset-password/complete", element: <ResetCompletePage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
      { path: "/verify-pending", element: <VerifyPendingPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      // Public: members see their home, guests the landing page. Requirement 5.1/1 needs updating if this stays.
      { path: "/", element: <HomeGate member={<HomePage />} guest={<GuestStarChart />} /> },
      { path: "/about", element: <AboutPage /> },
      {
        element: <RequireMember />,
        children: [
          { path: "/series", element: <BrowsePage kind="series" /> },
          { path: "/movies", element: <BrowsePage kind="movie" /> },
          { path: "/search", element: <BrowsePage kind="search" /> },
          { path: "/title/:slug", element: <TitlePage /> },
          { path: "/watch/:unitId", element: <WatchPage /> },
          { path: "/library", element: <LibraryPage /> },
          { path: "/playlists", element: <PublicPlaylistsPage /> },
          { path: "/playlists/:id", element: <PlaylistPage /> },
          { path: "/invites", element: <InvitesPage /> },
          { path: "/account", element: <AccountPage /> },
          {
            element: <RequireAdmin />,
            children: [
              { path: "/admin", element: <AdminPage /> },
              { path: "/admin/backups", element: <BackupsPage /> },
            ],
          },
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
