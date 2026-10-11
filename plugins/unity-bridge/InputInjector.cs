using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;

namespace OScribe.UnityBridge
{
    /// <summary>Commande reçue du client TCP, à exécuter sur le thread principal.</summary>
    public class BridgeCommand
    {
        public JObject Command;
        public Action<string> Reply;
    }

    /// <summary>
    /// Simule une souris dans le jeu sans toucher au curseur Windows : le clic passe par le système
    /// d'événements d'Unity (EventSystem), à des coordonnées de la fenêtre (origine en haut à gauche,
    /// comme les ScreenRect du snapshot). Le jeu n'a pas besoin du focus.
    /// </summary>
    internal static class InputInjector
    {
        /// <summary>Position de la dernière action, pour le curseur virtuel.</summary>
        internal static Vector2 LastPoint;
        internal static float LastActionTime = -10f;

        private static Vector2 ToUnity(float x, float y) => new Vector2(x, Screen.height - y);

        private static GameObject Raycast(Vector2 unityPos, out PointerEventData ped, out RaycastResult hit)
        {
            var es = EventSystem.current;
            ped = null;
            hit = default;
            if (es == null) return null;

            ped = new PointerEventData(es) { position = unityPos, button = PointerEventData.InputButton.Left };
            var results = new List<RaycastResult>();
            es.RaycastAll(ped, results);
            foreach (var r in results)
            {
                if (r.gameObject != null) { hit = r; return r.gameObject; }
            }
            return null;
        }

        private static string PathOf(GameObject go)
        {
            var path = go.name;
            for (var t = go.transform.parent; t != null; t = t.parent) path = t.name + "/" + path;
            return path;
        }

        internal static string Click(float x, float y)
        {
            LastPoint = new Vector2(x, y);
            LastActionTime = Time.realtimeSinceStartup;

            var go = Raycast(ToUnity(x, y), out var ped, out var hit);
            if (go == null) return Fail("aucun élément d'interface sous ce point");

            ped.pressPosition = ped.position;
            ped.pointerPressRaycast = hit;
            ped.pointerCurrentRaycast = hit;
            ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.pointerEnterHandler);
            var pressed = ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.pointerDownHandler);
            ped.pointerPress = pressed != null ? pressed : go;
            ped.rawPointerPress = go;
            ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.pointerUpHandler);
            ped.eligibleForClick = true;
            ped.clickCount = 1;
            var clicked = ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.pointerClickHandler);
            ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.pointerExitHandler);

            return new JObject
            {
                ["ok"] = true,
                ["hit"] = PathOf(go),
                ["handled"] = clicked != null,
                ["handler"] = clicked != null ? PathOf(clicked) : null
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        internal static string Scroll(float x, float y, float dy)
        {
            LastPoint = new Vector2(x, y);
            LastActionTime = Time.realtimeSinceStartup;

            var go = Raycast(ToUnity(x, y), out var ped, out _);
            if (go == null) return Fail("aucun élément d'interface sous ce point");
            ped.scrollDelta = new Vector2(0f, dy);
            var handled = ExecuteEvents.ExecuteHierarchy(go, ped, ExecuteEvents.scrollHandler);
            return new JObject { ["ok"] = true, ["hit"] = PathOf(go), ["handled"] = handled != null }
                .ToString(Newtonsoft.Json.Formatting.None);
        }

        /// <summary>Glisser-déposer : appui en (x1,y1), déplacement progressif, dépôt en (x2,y2).</summary>
        internal static IEnumerator Drag(float x1, float y1, float x2, float y2, Action<string> reply)
        {
            LastPoint = new Vector2(x1, y1);
            LastActionTime = Time.realtimeSinceStartup;

            var source = Raycast(ToUnity(x1, y1), out var ped, out var hit);
            if (source == null) { reply(Fail("aucun élément sous le point de départ")); yield break; }

            ped.pressPosition = ped.position;
            ped.pointerPressRaycast = hit;
            ped.pointerCurrentRaycast = hit;
            var pressed = ExecuteEvents.ExecuteHierarchy(source, ped, ExecuteEvents.pointerDownHandler);
            ped.pointerPress = pressed != null ? pressed : source;
            ped.rawPointerPress = source;
            var dragTarget = ExecuteEvents.GetEventHandler<IDragHandler>(source);
            ped.pointerDrag = dragTarget;
            if (dragTarget != null)
            {
                ExecuteEvents.Execute(dragTarget, ped, ExecuteEvents.initializePotentialDrag);
                ped.dragging = true;
                ExecuteEvents.Execute(dragTarget, ped, ExecuteEvents.beginDragHandler);
            }

            const int steps = 12;
            for (var i = 1; i <= steps; i++)
            {
                var p = Vector2.Lerp(new Vector2(x1, y1), new Vector2(x2, y2), i / (float)steps);
                LastPoint = p;
                LastActionTime = Time.realtimeSinceStartup;
                var pos = ToUnity(p.x, p.y);
                ped.delta = pos - ped.position;
                ped.position = pos;
                if (dragTarget != null) ExecuteEvents.Execute(dragTarget, ped, ExecuteEvents.dragHandler);
                yield return null;
            }

            var dropGo = Raycast(ToUnity(x2, y2), out _, out var dropHit);
            ped.pointerCurrentRaycast = dropHit;
            if (dropGo != null) ExecuteEvents.ExecuteHierarchy(dropGo, ped, ExecuteEvents.dropHandler);
            if (dragTarget != null) ExecuteEvents.Execute(dragTarget, ped, ExecuteEvents.endDragHandler);
            ped.dragging = false;
            ExecuteEvents.ExecuteHierarchy(source, ped, ExecuteEvents.pointerUpHandler);

            reply(new JObject
            {
                ["ok"] = true,
                ["from"] = PathOf(source),
                ["to"] = dropGo != null ? PathOf(dropGo) : null,
                ["dragHandler"] = dragTarget != null
            }.ToString(Newtonsoft.Json.Formatting.None));
        }

        /// <summary>Capture du rendu du jeu lui-même (visible même si une autre fenêtre le recouvre).</summary>
        internal static IEnumerator Screenshot(Action<string> reply)
        {
            yield return new WaitForEndOfFrame();
            Texture2D tex = null;
            try
            {
                tex = ScreenCapture.CaptureScreenshotAsTexture();
                var png = ImageConversion.EncodeToPNG(tex);
                reply(new JObject
                {
                    ["ok"] = true,
                    ["width"] = tex.width,
                    ["height"] = tex.height,
                    ["png"] = Convert.ToBase64String(png)
                }.ToString(Newtonsoft.Json.Formatting.None));
            }
            catch (Exception ex)
            {
                reply(Fail("capture impossible : " + ex.Message));
            }
            finally
            {
                if (tex != null) UnityEngine.Object.Destroy(tex);
            }
        }

        internal static string Fail(string message)
        {
            return new JObject { ["ok"] = false, ["error"] = message }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
