using UnityEngine;
using UnityEngine.EventSystems;

namespace OScribe.UnityBridge
{
    /// <summary>
    /// Utility class for detecting interactable elements at screen positions.
    /// Used for debugging and validation.
    /// </summary>
    public static class UIElementDetector
    {
        /// <summary>
        /// Find UI element at screen position using EventSystem raycast.
        /// </summary>
        public static GameObject GetUIElementAtPosition(Vector2 screenPos)
        {
            var eventData = new PointerEventData(EventSystem.current)
            {
                position = screenPos
            };

            var results = new System.Collections.Generic.List<RaycastResult>();
            EventSystem.current?.RaycastAll(eventData, results);

            return results.Count > 0 ? results[0].gameObject : null;
        }

        /// <summary>
        /// Find 3D object at screen position using Physics raycast.
        /// </summary>
        public static GameObject Get3DElementAtPosition(Vector2 screenPos)
        {
            var camera = Camera.main;
            if (camera == null) return null;

            var ray = camera.ScreenPointToRay(screenPos);
            if (Physics.Raycast(ray, out var hit, Mathf.Infinity))
            {
                return hit.collider.gameObject;
            }

            // Try 2D raycast
            var hit2D = Physics2D.Raycast(screenPos, Vector2.zero);
            if (hit2D.collider != null)
            {
                return hit2D.collider.gameObject;
            }

            return null;
        }

        /// <summary>
        /// Get any element (UI or 3D) at screen position.
        /// UI takes priority over 3D.
        /// </summary>
        public static GameObject GetElementAtPosition(Vector2 screenPos)
        {
            return GetUIElementAtPosition(screenPos) ?? Get3DElementAtPosition(screenPos);
        }
    }
}
