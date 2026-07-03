import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    // The APNs device token (hex) once received, held until the WKWebView is
    // ready to receive it. Divvy loads a REMOTE url, so the only bridge to the
    // web layer is evaluateJavaScript on Capacitor's web view — we inject the
    // token there (window.__divvyApnsToken + an 'apnstoken' event) and retry
    // until the page is up.
    private var pendingApnsToken: String?
    private var apnsInjectAttempts = 0

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Ask for notification permission a moment after launch so it doesn't
        // collide with the first paint / any Capacitor bootstrap. On grant we
        // register for remote notifications (must run on the main thread).
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                guard granted else { return }
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
        return true
    }

    // MARK: - Remote notification registration

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        pendingApnsToken = hex
        apnsInjectAttempts = 0
        injectApnsToken()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Non-fatal: on a device without push entitlement / no network this just
        // means no native pushes this session. The web-push path still works.
        NSLog("Divvy: remote notification registration failed: \(error.localizedDescription)")
    }

    // Push the token into the web layer. The remote page may not be loaded yet,
    // so retry on a short timer until Capacitor's web view exists; keep injecting
    // a few extra times so it also lands after the page's own load handlers are
    // attached (the web layer listens for the 'apnstoken' event AND reads the
    // global at boot).
    private func injectApnsToken() {
        guard let token = pendingApnsToken else { return }
        apnsInjectAttempts += 1

        if let webView = (window?.rootViewController as? CAPBridgeViewController)?.webView {
            let js = "window.__divvyApnsToken='\(token)'; window.dispatchEvent(new Event('apnstoken'));"
            webView.evaluateJavaScript(js, completionHandler: nil)
            // Re-inject a couple more times to cover a page that reloads shortly
            // after launch, then stop.
            if apnsInjectAttempts < 4 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in self?.injectApnsToken() }
            }
            return
        }

        // Web view not up yet — retry for up to ~20s, then give up quietly.
        if apnsInjectAttempts < 20 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.injectApnsToken() }
        }
    }

    // MARK: - Foreground presentation

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show notifications even while the app is in the foreground.
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        // If a token arrived before the web view was ready, take another shot now
        // that the app is active and the page has likely loaded.
        if pendingApnsToken != nil {
            apnsInjectAttempts = 0
            injectApnsToken()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
