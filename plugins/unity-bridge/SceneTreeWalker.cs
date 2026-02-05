using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System.Collections.Generic;
using System.Linq;

namespace OScribe.UnityBridge
{
    public class SceneTreeWalker
    {
        private Camera _mainCamera;

        /// <summary>
        /// Récupère TOUS les éléments : Canvas UI + GameObjects 3D interactifs
        /// </summary>
        public List<UIElementData> GetAllElements()
        {
            _mainCamera = Camera.main;
            var elements = new List<UIElementData>();

            // 1. Canvas UI (boutons, textes, etc.)
            GetCanvasElements(elements);

            // 2. GameObjects 3D avec Collider (cartes, personnages, objets cliquables)
            Get3DInteractiveElements(elements);

            return elements;
        }

        #region Canvas UI Elements

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
            var fullPath = string.IsNullOrEmpty(path) ? t.name : $"{path}/{t.name}";

            var element = TryCreateUIElement(t, fullPath);
            if (element != null)
            {
                elements.Add(element);
            }

            foreach (Transform child in t)
            {
                WalkCanvasTransform(child, elements, fullPath);
            }
        }

        private UIElementData TryCreateUIElement(Transform t, string path)
        {
            var rectTransform = t.GetComponent<RectTransform>();
            if (rectTransform == null) return null;

            // Detect UI component type
            string type = null;
            string value = null;
            bool isInteractable = false;

            var button = t.GetComponent<Button>();
            var toggle = t.GetComponent<Toggle>();
            var slider = t.GetComponent<Slider>();
            var inputField = t.GetComponent<InputField>();
            var tmpInput = t.GetComponent<TMP_InputField>();
            var dropdown = t.GetComponent<Dropdown>();
            var tmpDropdown = t.GetComponent<TMP_Dropdown>();
            var text = t.GetComponent<Text>();
            var tmpText = t.GetComponent<TMP_Text>();
            var image = t.GetComponent<Image>();

            if (button != null)
            {
                type = "Button";
                isInteractable = button.interactable;
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
            else if (tmpInput != null)
            {
                type = "InputField";
                value = tmpInput.text;
                isInteractable = tmpInput.interactable;
            }
            else if (dropdown != null || tmpDropdown != null)
            {
                type = "Dropdown";
                isInteractable = dropdown?.interactable ?? tmpDropdown?.interactable ?? false;
            }
            else if (tmpText != null)
            {
                type = "Text";
                value = tmpText.text;
            }
            else if (text != null)
            {
                type = "Text";
                value = text.text;
            }
            else if (image != null && image.raycastTarget)
            {
                type = "Image";
                isInteractable = true; // Clickable image
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

        #endregion

        #region 3D Interactive Elements

        private void Get3DInteractiveElements(List<UIElementData> elements)
        {
            if (_mainCamera == null) return;

            // Find all GameObjects with Colliders that are interactive
            var colliders = Object.FindObjectsOfType<Collider>()
                .Where(c => c.gameObject.activeInHierarchy)
                .Where(c => IsInteractive3DObject(c.gameObject));

            foreach (var collider in colliders)
            {
                var element = TryCreate3DElement(collider);
                if (element != null)
                {
                    elements.Add(element);
                }
            }

            // Also check 2D colliders (for 2D games)
            var colliders2D = Object.FindObjectsOfType<Collider2D>()
                .Where(c => c.gameObject.activeInHierarchy)
                .Where(c => IsInteractive3DObject(c.gameObject));

            foreach (var collider in colliders2D)
            {
                var element = TryCreate2DElement(collider);
                if (element != null)
                {
                    elements.Add(element);
                }
            }
        }

        private bool IsInteractive3DObject(GameObject go)
        {
            // Has click handler, or is tagged as interactive, or has common interactive components
            return go.GetComponent<IPointerClickHandler>() != null
                || go.GetComponent<IPointerDownHandler>() != null
                || go.CompareTag("Interactable")
                || go.CompareTag("Card")
                || go.layer == LayerMask.NameToLayer("Interactive")
                || go.layer == LayerMask.NameToLayer("UI");
        }

        private UIElementData TryCreate3DElement(Collider collider)
        {
            var bounds = collider.bounds;
            var screenRect = GetScreenRectFrom3DBounds(bounds);

            if (screenRect == null) return null; // Behind camera or off-screen

            var go = collider.gameObject;
            return new UIElementData
            {
                Type = Detect3DType(go),
                Name = go.name,
                Path = GetGameObjectPath(go),
                ScreenRect = screenRect,
                IsInteractable = true,
                IsVisible = true,
                Is3D = true,
                Value = GetGameObjectValue(go)
            };
        }

        private UIElementData TryCreate2DElement(Collider2D collider)
        {
            var bounds = collider.bounds;
            var screenRect = GetScreenRectFrom3DBounds(bounds);

            if (screenRect == null) return null;

            var go = collider.gameObject;
            return new UIElementData
            {
                Type = Detect3DType(go),
                Name = go.name,
                Path = GetGameObjectPath(go),
                ScreenRect = screenRect,
                IsInteractable = true,
                IsVisible = true,
                Is3D = true,
                Value = GetGameObjectValue(go)
            };
        }

        private string Detect3DType(GameObject go)
        {
            // Heuristics based on name/tag/components
            var nameLower = go.name.ToLower();
            if (nameLower.Contains("card")) return "Card3D";
            if (nameLower.Contains("button")) return "Button3D";
            if (nameLower.Contains("hero") || nameLower.Contains("character")) return "Character3D";
            if (nameLower.Contains("minion")) return "Minion3D";
            if (go.CompareTag("Card")) return "Card3D";
            return "Interactive3D";
        }

        private string GetGameObjectValue(GameObject go)
        {
            // Try to get text from child TextMeshPro or Text
            var tmp = go.GetComponentInChildren<TMP_Text>();
            if (tmp != null) return tmp.text;

            var text = go.GetComponentInChildren<Text>();
            if (text != null) return text.text;

            return null;
        }

        #endregion

        #region Coordinate Conversion

        private ScreenRect GetScreenRectFromRectTransform(RectTransform rt)
        {
            var corners = new Vector3[4];
            rt.GetWorldCorners(corners);

            var min = RectTransformUtility.WorldToScreenPoint(null, corners[0]);
            var max = RectTransformUtility.WorldToScreenPoint(null, corners[2]);

            // Flip Y (Unity screen Y=0 is bottom, we want Y=0 at top)
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

            // Project 8 corners of bounds to screen
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
                var screenPos = _mainCamera.WorldToScreenPoint(corner);

                // Behind camera check
                if (screenPos.z < 0) return null;

                minX = Mathf.Min(minX, screenPos.x);
                maxX = Mathf.Max(maxX, screenPos.x);
                minY = Mathf.Min(minY, screenPos.y);
                maxY = Mathf.Max(maxY, screenPos.y);
            }

            // Off-screen check
            if (maxX < 0 || minX > Screen.width || maxY < 0 || minY > Screen.height)
                return null;

            return new ScreenRect
            {
                X = minX,
                Y = Screen.height - maxY, // Flip Y
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

        #endregion
    }
}
