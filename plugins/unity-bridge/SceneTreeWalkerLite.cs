using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using System.Linq;

namespace OScribe.UnityBridge
{
    /// <summary>
    /// Lite version - works without TMPro (for games that don't use it)
    /// </summary>
    public class SceneTreeWalker
    {
        private Camera _mainCamera;

        public List<UIElementData> GetAllElements()
        {
            _mainCamera = Camera.main;
            var elements = new List<UIElementData>();
            GetCanvasElements(elements);
            Get3DInteractiveElements(elements);
            return elements;
        }

        private void GetCanvasElements(List<UIElementData> elements)
        {
            var canvases = Object.FindObjectsOfType<Canvas>()
                .Where(c => c.gameObject.activeInHierarchy);

            foreach (var canvas in canvases)
            {
                WalkCanvasTransform(canvas.transform, elements, canvas.name);
            }
        }

        private void WalkCanvasTransform(Transform t, List<UIElementData> elements, string path)
        {
            var fullPath = string.IsNullOrEmpty(path) ? t.name : path + "/" + t.name;

            var element = TryCreateUIElement(t, fullPath);
            if (element != null)
                elements.Add(element);

            foreach (Transform child in t)
                WalkCanvasTransform(child, elements, fullPath);
        }

        private UIElementData TryCreateUIElement(Transform t, string path)
        {
            var rectTransform = t.GetComponent<RectTransform>();
            if (rectTransform == null) return null;

            string type = null;
            string value = null;
            bool isInteractable = false;

            var button = t.GetComponent<Button>();
            var toggle = t.GetComponent<Toggle>();
            var slider = t.GetComponent<Slider>();
            var inputField = t.GetComponent<InputField>();
            var dropdown = t.GetComponent<Dropdown>();
            var text = t.GetComponent<Text>();
            var image = t.GetComponent<Image>();

            if (button != null)
            {
                type = "Button";
                isInteractable = button.interactable;
                // Try to get button label from child Text
                var childText = t.GetComponentInChildren<Text>();
                if (childText != null) value = childText.text;
            }
            else if (toggle != null)
            {
                type = "Toggle";
                value = toggle.isOn.ToString();
                isInteractable = toggle.interactable;
            }
            else if (slider != null)
            {
                type = "Slider";
                value = slider.value.ToString("F2");
                isInteractable = slider.interactable;
            }
            else if (inputField != null)
            {
                type = "InputField";
                value = inputField.text;
                isInteractable = inputField.interactable;
            }
            else if (dropdown != null)
            {
                type = "Dropdown";
                isInteractable = dropdown.interactable;
            }
            else if (text != null)
            {
                type = "Text";
                value = text.text;
            }
            else if (image != null && image.raycastTarget)
            {
                type = "Image";
                isInteractable = true;
            }

            if (type == null) return null;

            var screenRect = GetScreenRectFromRectTransform(rectTransform);

            return new UIElementData
            {
                Type = type,
                Name = t.name,
                Path = path,
                ScreenRect = screenRect,
                IsInteractable = isInteractable,
                IsVisible = t.gameObject.activeInHierarchy && IsVisibleOnScreen(screenRect),
                Value = value,
                Is3D = false
            };
        }

        private void Get3DInteractiveElements(List<UIElementData> elements)
        {
            if (_mainCamera == null) return;

            var colliders = Object.FindObjectsOfType<Collider>()
                .Where(c => c.gameObject.activeInHierarchy);

            foreach (var collider in colliders)
            {
                var bounds = collider.bounds;
                var screenRect = GetScreenRectFrom3DBounds(bounds);
                if (screenRect == null) continue;

                var go = collider.gameObject;
                elements.Add(new UIElementData
                {
                    Type = "Interactive3D",
                    Name = go.name,
                    Path = GetGameObjectPath(go),
                    ScreenRect = screenRect,
                    IsInteractable = true,
                    IsVisible = true,
                    Is3D = true,
                    Value = GetTextValue(go)
                });
            }
        }

        private string GetTextValue(GameObject go)
        {
            var text = go.GetComponentInChildren<Text>();
            return text != null ? text.text : null;
        }

        private ScreenRect GetScreenRectFromRectTransform(RectTransform rt)
        {
            var corners = new Vector3[4];
            rt.GetWorldCorners(corners);
            var min = RectTransformUtility.WorldToScreenPoint(null, corners[0]);
            var max = RectTransformUtility.WorldToScreenPoint(null, corners[2]);

            return new ScreenRect
            {
                X = min.x,
                Y = Screen.height - max.y,
                Width = max.x - min.x,
                Height = max.y - min.y
            };
        }

        private ScreenRect GetScreenRectFrom3DBounds(Bounds bounds)
        {
            if (_mainCamera == null) return null;

            var corners = new Vector3[8];
            var c = bounds.center;
            var e = bounds.extents;
            corners[0] = c + new Vector3(-e.x, -e.y, -e.z);
            corners[1] = c + new Vector3(e.x, -e.y, -e.z);
            corners[2] = c + new Vector3(-e.x, e.y, -e.z);
            corners[3] = c + new Vector3(e.x, e.y, -e.z);
            corners[4] = c + new Vector3(-e.x, -e.y, e.z);
            corners[5] = c + new Vector3(e.x, -e.y, e.z);
            corners[6] = c + new Vector3(-e.x, e.y, e.z);
            corners[7] = c + new Vector3(e.x, e.y, e.z);

            float minX = float.MaxValue, minY = float.MaxValue;
            float maxX = float.MinValue, maxY = float.MinValue;

            foreach (var corner in corners)
            {
                var sp = _mainCamera.WorldToScreenPoint(corner);
                if (sp.z < 0) return null;
                minX = Mathf.Min(minX, sp.x);
                maxX = Mathf.Max(maxX, sp.x);
                minY = Mathf.Min(minY, sp.y);
                maxY = Mathf.Max(maxY, sp.y);
            }

            if (maxX < 0 || minX > Screen.width || maxY < 0 || minY > Screen.height)
                return null;

            return new ScreenRect
            {
                X = minX,
                Y = Screen.height - maxY,
                Width = maxX - minX,
                Height = maxY - minY
            };
        }

        private bool IsVisibleOnScreen(ScreenRect rect)
        {
            return rect.X + rect.Width > 0
                && rect.X < Screen.width
                && rect.Y + rect.Height > 0
                && rect.Y < Screen.height;
        }

        private string GetGameObjectPath(GameObject go)
        {
            var path = go.name;
            var parent = go.transform.parent;
            while (parent != null)
            {
                path = parent.name + "/" + path;
                parent = parent.parent;
            }
            return path;
        }
    }
}
